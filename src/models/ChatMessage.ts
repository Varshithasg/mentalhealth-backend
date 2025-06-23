import mongoose, { Document, Schema } from 'mongoose';

export interface IChatMessage extends Document {
  user: mongoose.Types.ObjectId;
  sessionId: string;
  message: string;
  response: string;
  messageType: 'user' | 'ai' | 'system';
  intent?: string;
  confidence?: number;
  mood?: 'positive' | 'negative' | 'neutral' | 'anxious' | 'depressed';
  escalationLevel: number; // 0-5, where 5 means immediate human intervention needed
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sessionId: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true,
    maxlength: 2000
  },
  response: {
    type: String,
    required: false,
    maxlength: 2000
  },
  messageType: {
    type: String,
    enum: ['user', 'ai', 'system'],
    required: true
  },
  intent: {
    type: String,
    maxlength: 100
  },
  confidence: {
    type: Number,
    min: 0,
    max: 1
  },
  mood: {
    type: String,
    enum: ['positive', 'negative', 'neutral', 'anxious', 'depressed']
  },
  escalationLevel: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  tags: [{
    type: String,
    maxlength: 50
  }]
}, {
  timestamps: true
});

// Index for efficient queries
chatMessageSchema.index({ user: 1, sessionId: 1, createdAt: -1 });
chatMessageSchema.index({ escalationLevel: 1, createdAt: -1 });

export default mongoose.model<IChatMessage>('ChatMessage', chatMessageSchema); 