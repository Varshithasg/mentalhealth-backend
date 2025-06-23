import express, { Response } from 'express';
import Notification from '../models/Notification';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = express.Router();

// Get notifications for the logged-in user
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const notifications = await Notification.find({ recipient: req.user?._id })
      .sort({ createdAt: -1 })
      .limit(50); // Limit to last 50 notifications

    const unreadCount = await Notification.countDocuments({ recipient: req.user?._id, read: false });

    return res.json({ notifications, unreadCount });
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching notifications' });
  }
});

// Mark a notification as read
router.post('/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user?._id },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    return res.json(notification);
  } catch (error) {
    return res.status(500).json({ message: 'Error updating notification' });
  }
});

export default router; 