import mongoose, { Document, Schema } from 'mongoose';

export interface INotification extends Document {
  recipient: mongoose.Types.ObjectId;
  recipientModel: 'User' | 'Therapist' | 'Admin';
  sender?: mongoose.Types.ObjectId;
  senderModel?: 'User' | 'Therapist' | 'System';
  type: 'new_user' | 'new_therapist' | 'appointment_booked' | 'appointment_cancelled' | 'review_left' | 'therapist_verified';
  message: string;
  link?: string; // e.g., /admin/therapists/some_id
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>({
  recipient: {
    type: Schema.Types.ObjectId,
    required: true,
    refPath: 'recipientModel'
  },
  recipientModel: {
    type: String,
    required: true,
    enum: ['User', 'Therapist', 'Admin']
  },
  sender: {
    type: Schema.Types.ObjectId,
    refPath: 'senderModel'
  },
  senderModel: {
    type: String,
    enum: ['User', 'Therapist', 'System']
  },
  type: {
    type: String,
    required: true,
    enum: ['new_user', 'new_therapist', 'appointment_booked', 'appointment_cancelled', 'review_left', 'therapist_verified']
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  link: {
    type: String
  },
  read: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

export default mongoose.model<INotification>('Notification', notificationSchema); 