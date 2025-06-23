import dotenv from 'dotenv';
dotenv.config(); // This must be the very first line

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import path from 'path';

// Import routes
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import therapistRoutes from './routes/therapist';
import adminRoutes from './routes/admin';
import appointmentRoutes from './routes/appointment';
import chatbotRoutes from './routes/chatbot';
import notificationRoutes from './routes/notification';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000 // or even 0 to disable
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files (uploaded images)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mental-wellness')
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', authMiddleware, userRoutes);
app.use('/api/therapist', authMiddleware, therapistRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);
app.use('/api/appointments', authMiddleware, appointmentRoutes);
app.use('/api/chatbot', authMiddleware, chatbotRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'API is live ✅' });
});


// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Mental Wellness API is running' });
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app; 