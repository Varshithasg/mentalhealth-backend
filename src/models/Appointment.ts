import mongoose, { Document, Schema } from 'mongoose';

export interface IAppointment extends Document {
  user: mongoose.Types.ObjectId;
  therapist: mongoose.Types.ObjectId;
  date: Date;
  startTime: string;
  endTime: string;
  duration: number; // in minutes
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no-show';
  sessionType: 'individual' | 'group' | 'couple';
  sessionMode: 'video' | 'audio' | 'chat' | 'in-person';
  notes?: string;
  cancellationReason?: string;
  rating?: number;
  review?: string;
  paymentStatus: 'pending' | 'paid' | 'refunded';
  amount: number;
  meetingLink?: string;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<IAppointment>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  therapist: {
    type: Schema.Types.ObjectId,
    ref: 'Therapist',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  startTime: {
    type: String,
    required: true
  },
  endTime: {
    type: String,
    required: true
  },
  duration: {
    type: Number,
    required: true,
    min: 30,
    max: 180
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no-show'],
    default: 'pending'
  },
  sessionType: {
    type: String,
    enum: ['individual', 'group', 'couple'],
    default: 'individual'
  },
  sessionMode: {
    type: String,
    enum: ['video', 'audio', 'chat', 'in-person'],
    default: 'video'
  },
  notes: {
    type: String,
    maxlength: 1000
  },
  cancellationReason: {
    type: String,
    maxlength: 500
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  review: {
    type: String,
    maxlength: 1000
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending'
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  meetingLink: {
    type: String
  }
}, {
  timestamps: true
});

// Index for efficient queries
appointmentSchema.index({ user: 1, date: 1 });
appointmentSchema.index({ therapist: 1, date: 1 });
appointmentSchema.index({ status: 1, date: 1 });

export default mongoose.model<IAppointment>('Appointment', appointmentSchema); 