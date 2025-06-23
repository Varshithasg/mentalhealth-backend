import express, { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import Therapist from '../models/Therapist';
import Appointment from '../models/Appointment';
import ChatMessage from '../models/ChatMessage';
import Admin from '../models/Admin';
import { requireAdmin, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const router = express.Router();

// Get all users
router.get('/users', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;
    const filter: any = {};

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) {
      filter.isActive = status === 'active';
    }

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));

    const total = await User.countDocuments(filter);

    res.json({
      users,
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total
    });
  } catch (error) {
    next(error);
  }
});

// Get all therapists
router.get('/therapists', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = 1, limit = 10, search, status, verified } = req.query;
    const filter: any = {};

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { licenseNumber: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) {
      filter.isActive = status === 'active';
    }

    if (verified) {
      filter.isVerified = verified === 'verified';
    }

    const therapists = await Therapist.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));

    const total = await Therapist.countDocuments(filter);

    res.json({
      therapists,
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total
    });
  } catch (error) {
    next(error);
  }
});

// Verify therapist
router.put('/therapists/:id/verify', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const therapist = await Therapist.findByIdAndUpdate(
      req.params.id,
      { isVerified: true },
      { new: true }
    ).select('-password');

    if (!therapist) {
      return res.status(404).json({ message: 'Therapist not found' });
    }

    return res.json({ therapist });
  } catch (error) {
    return next(error);
  }
});

// Toggle user status
router.put('/users/:id/toggle-status', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userType } = req.query;
    let Model: any;
    let user;

    if (userType === 'user') {
      Model = User;
    } else if (userType === 'therapist') {
      Model = Therapist;
    } else {
      return res.status(400).json({ message: 'Invalid user type' });
    }

    const doc = await Model.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'User not found' });
    }

    user = await Model.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: !doc.isActive } },
      { new: true }
    ).select('-password');

    return res.json({ user });
  } catch (error) {
    return next(error);
  }
});

// Admin Change Password
router.put('/change-password', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Please provide current and new passwords.' });
    }

    try {
        const admin = await Admin.findById(req.user?._id);
        if (!admin) {
            return res.status(404).json({ message: 'Admin not found.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, admin.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect current password.' });
        }

        const salt = await bcrypt.genSalt(10);
        admin.password = await bcrypt.hash(newPassword, salt);
        await admin.save();

        return res.json({ message: 'Password updated successfully.' });

    } catch (error) {
        return next(error);
    }
});

// Get analytics
router.get('/analytics', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { period = 'month' } = req.query;
    let startDate: Date;
    const now = new Date();

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'quarter':
        startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const [
        platformStats,
        userGrowth,
        revenueAnalytics,
        therapistStats,
        appointmentStatus
    ] = await Promise.all([
      getPlatformStats(startDate),
      getGrowthData(startDate, period as string),
      getRevenueData(startDate, period as string),
      getTherapistStats(),
      getAppointmentStatus(startDate),
    ]);
    
    res.json({
        platformStats,
        userGrowth,
        revenueAnalytics,
        therapistStats,
        appointmentStatus,
    });
  } catch (error) {
    next(error);
  }
});

async function getPlatformStats(startDate: Date) {
  const [totalUsers, totalTherapists, totalAppointments, completedAppointments, totalRevenue, chatbotMessages] = await Promise.all([
      User.countDocuments(),
      Therapist.countDocuments(),
      Appointment.countDocuments({ createdAt: { $gte: startDate } }),
      Appointment.countDocuments({ status: 'completed', createdAt: { $gte: startDate } }),
      Appointment.aggregate([
          { $match: { status: 'completed', createdAt: { $gte: startDate } } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      ChatMessage.countDocuments({ createdAt: { $gte: startDate } })
  ]);
  return { totalUsers, totalTherapists, totalAppointments, completedAppointments, totalRevenue: totalRevenue[0]?.total || 0, chatbotMessages };
}

async function getGrowthData(startDate: Date, period: string) {
    const format = (period === 'week' || period === 'month') ? '%Y-%m-%d' : '%Y-%m';
    const users = await User.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format, date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
    const therapists = await Therapist.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format, date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
    
    const labels = [...new Set([...users.map(u => u._id), ...therapists.map(t => t._id)])].sort();
    const userData = labels.map(label => users.find(u => u._id === label)?.count || 0);
    const therapistData = labels.map(label => therapists.find(t => t._id === label)?.count || 0);

    return { labels, users: userData, therapists: therapistData };
}

async function getRevenueData(startDate: Date, period: string) {
    const format = (period === 'week' || period === 'month') ? '%Y-%m-%d' : '%Y-%m';
    const revenue = await Appointment.aggregate([
        { $match: { status: 'completed', date: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format, date: '$date' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
    return {
        labels: revenue.map(r => r._id),
        revenue: revenue.map(r => r.total),
        appointments: revenue.map(r => r.count),
    };
}

async function getTherapistStats() {
    const [verified, pending, active, inactive] = await Promise.all([
        Therapist.countDocuments({ isVerified: true }),
        Therapist.countDocuments({ isVerified: false }),
        Therapist.countDocuments({ isActive: true }),
        Therapist.countDocuments({ isActive: false }),
    ]);
    return { verified, pending, active, inactive };
}

async function getAppointmentStatus(startDate: Date) {
    const statuses = await Appointment.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    return {
        labels: statuses.map(s => s._id),
        data: statuses.map(s => s.count),
    };
}

// Get chatbot analytics
router.get('/chatbot-analytics', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days as string));

    const [
      totalMessages,
      escalationCount,
      moodDistribution,
      topIntents
    ] = await Promise.all([
      ChatMessage.countDocuments({ createdAt: { $gte: startDate } }),
      ChatMessage.countDocuments({ 
        escalationLevel: { $gte: 4 },
        createdAt: { $gte: startDate }
      }),
      ChatMessage.aggregate([
        { $match: { createdAt: { $gte: startDate }, mood: { $exists: true } } },
        { $group: { _id: '$mood', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ChatMessage.aggregate([
        { $match: { createdAt: { $gte: startDate }, intent: { $exists: true } } },
        { $group: { _id: '$intent', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    res.json({
      totalMessages,
      escalationCount,
      moodDistribution,
      topIntents,
      period: `${days} days`
    });
  } catch (error) {
    next(error);
  }
});

export default router; 