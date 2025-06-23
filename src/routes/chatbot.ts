import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import Groq from 'groq-sdk';
import ChatMessage from '../models/ChatMessage';
import { requireUser, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Lazy initialization of Groq client
let groq: Groq | null = null;

const getGroqClient = (): Groq => {
  if (!groq) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY environment variable is not set. Please add it to your .env file.');
    }
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  return groq;
};

// Mental health support prompts and responses
const mentalHealthPrompts = {
  system: `You are a compassionate AI mental health support assistant. Your role is to:
1. Provide empathetic and supportive responses
2. Offer grounding techniques and coping strategies
3. Recognize when to escalate to human intervention
4. Never provide medical advice or diagnosis
5. Encourage professional help when appropriate
6. Use a warm, understanding tone

Key guidelines:
- Always prioritize safety and well-being
- Escalate to level 5 if user mentions self-harm, suicide, or severe crisis
- Provide practical coping strategies and breathing exercises
- Share motivational quotes and positive affirmations
- Suggest booking a therapist when appropriate

Response format:
- Keep responses under 200 words
- Include specific coping techniques when relevant
- End with a supportive closing message`,

  groundingTechniques: [
    "Take 5 deep breaths: inhale for 4 counts, hold for 4, exhale for 6",
    "Name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste",
    "Progressive muscle relaxation: tense and release each muscle group",
    "Use the 5-4-3-2-1 grounding exercise",
    "Focus on your feet on the ground and feel the support beneath you"
  ],

  motivationalQuotes: [
    "You are stronger than you think, braver than you believe, and more capable than you imagine.",
    "Every day is a new beginning. Take a deep breath and start again.",
    "Your mental health is a priority. Your happiness is essential. Your self-care is a necessity.",
    "It's okay to not be okay. It's okay to ask for help. It's okay to take time for yourself.",
    "You don't have to be perfect to be worthy of love and respect."
  ]
};

// Analyze message for intent and mood
const analyzeMessage = async (message: string) => {
  try {
    const completion = await getGroqClient().chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Analyze this message for:
1. Intent (crisis, support, information, casual)
2. Mood (positive, negative, neutral, anxious, depressed)
3. Escalation level (0-5, where 5 = immediate human intervention needed)
4. Suggested response type (grounding, support, referral, crisis)

Respond in JSON format:
{
  "intent": "string",
  "mood": "string", 
  "escalationLevel": number,
  "responseType": "string",
  "confidence": number
}`
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    });

    const analysis = JSON.parse(completion.choices[0].message.content || '{}');
    return analysis;
  } catch (error) {
    console.error('Error analyzing message:', error);
    return {
      intent: 'support',
      mood: 'neutral',
      escalationLevel: 0,
      responseType: 'support',
      confidence: 0.5
    };
  }
};

// Generate AI response
const generateResponse = async (message: string, analysis: any, conversationHistory: any[]) => {
  try {
    let responsePrompt = mentalHealthPrompts.system;

    // Add context based on analysis
    if (analysis.escalationLevel >= 4) {
      responsePrompt += `\n\nURGENT: User may be in crisis. Provide immediate support and strongly encourage professional help.`;
    }

    if (analysis.mood === 'anxious' || analysis.mood === 'depressed') {
      responsePrompt += `\n\nUser appears to be experiencing ${analysis.mood} feelings. Provide specific grounding techniques and coping strategies.`;
    }

    // Add conversation history for context
    if (conversationHistory.length > 0) {
      responsePrompt += `\n\nRecent conversation context:\n`;
      conversationHistory.slice(-3).forEach((msg: any) => {
        responsePrompt += `User: ${msg.message}\nAI: ${msg.response}\n`;
      });
    }

    const completion = await getGroqClient().chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: responsePrompt
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    return completion.choices[0].message.content || "I'm here to support you. How are you feeling today?";
  } catch (error) {
    console.error('Error generating response:', error);
    return "I'm here to listen and support you. Remember, it's okay to not be okay, and professional help is always available.";
  }
};

// Route to handle sending a message to the chatbot
router.post(
  '/send',
  [
    requireUser, // Ensures the user is logged in
    body('message').trim().notEmpty().withMessage('Message cannot be empty.'),
    body('sessionId').optional().isString().withMessage('Session ID must be a string.'),
  ],
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      console.log('[Chatbot] Received request with body:', JSON.stringify(req.body, null, 2));
      // Validate request body
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { message, sessionId: existingSessionId } = req.body;
      const sessionId = existingSessionId || `session_${Date.now()}`;

      // Save the user's message to the database
      const userMessage = new ChatMessage({
        user: req.user?._id,
        sessionId,
        message,
        messageType: 'user',
      });
      await userMessage.save();

      // Retrieve conversation history for context
      const conversationHistory = await ChatMessage.find({ sessionId })
        .sort({ createdAt: 'asc' })
        .limit(20);

      // Format messages for the Groq API
      const messagesForApi: Groq.Chat.ChatCompletionMessageParam[] = conversationHistory.map(
        (msg) => ({
          role: msg.messageType === 'user' ? 'user' : 'assistant',
          content: msg.message,
        })
      );

      // Add the system prompt
      const systemMessage: Groq.Chat.ChatCompletionMessageParam = {
        role: 'system',
        content:
          'You are a compassionate AI mental health support assistant. Your role is to provide empathetic and supportive responses, offer grounding techniques, and coping strategies. You must never provide medical advice or diagnosis. Always encourage professional help when appropriate. Keep responses concise and use a warm, understanding tone.',
      };

      // Get the Groq client and create the chat completion
      const groqAI = getGroqClient();
      const completion = await groqAI.chat.completions.create({
        messages: [systemMessage, ...messagesForApi],
        model: 'llama3-8b-8192',
        temperature: 0.7,
        max_tokens: 1024,
      });

      const aiResponse = completion.choices[0]?.message?.content || 'I apologize, but I am having trouble responding right now. Please try again.';

      // Save the AI's response to the database
      const aiMessage = new ChatMessage({
        user: req.user?._id,
        sessionId,
        message: aiResponse,
        messageType: 'ai',
      });
      await aiMessage.save();

      // Return the AI's message and the session ID
      return res.json({
        aiMessage,
        sessionId,
      });
    } catch (error) {
      console.error('[Chatbot] Error:', error);
      // Pass any errors to the global error handler
      return next(error);
    }
  }
);

// Get chat history
router.get('/history', requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { sessionId, page = 1, limit = 50 } = req.query;
    const filter: any = { user: req.user?._id };

    if (sessionId) {
      filter.sessionId = sessionId;
    }

    const messages = await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));

    const total = await ChatMessage.countDocuments(filter);

    return res.json({
      messages: messages.reverse(), // Return in chronological order
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total
    });
  } catch (error) {
    return next(error);
  }
});

// Get chat sessions
router.get('/sessions', requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sessions = await ChatMessage.aggregate([
      { $match: { user: req.user?._id } },
      { $group: { _id: '$sessionId', lastMessage: { $last: '$message' }, lastTimestamp: { $last: '$createdAt' } } },
      { $sort: { lastTimestamp: -1 } }
    ]);

    return res.json({ sessions });
  } catch (error) {
    return next(error);
  }
});

export default router; 