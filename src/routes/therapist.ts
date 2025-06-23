import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import Therapist from '../models/Therapist';
import Appointment from '../models/Appointment';
import { requireTherapist, AuthRequest } from '../middleware/auth';
import mongoose from 'mongoose';

const router = express.Router();

// Get therapist profile
router.get('/profile', requireTherapist, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const therapist = await Therapist.findById(req.user?._id).select('-password');
    return res.json({ therapist });
  } catch (error) {
    return next(error);
  }
});

// Update therapist profile
router.put('/profile', [
  requireTherapist,
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }),
  body('bio').optional().trim().isLength({ min: 50, max: 1000 }),
  body('specializations').optional().isArray(),
  body('hourlyRate').optional().isFloat({ min: 0 }),
  body('languages').optional().isArray()
], async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updates = req.body;
    const therapist = await Therapist.findByIdAndUpdate(
      req.user?._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    return res.json({ therapist });
  } catch (error) {
    return next(error);
  }
});

// Update availability
router.put('/availability', [
  requireTherapist,
  body('availability').isArray()
], async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { availability } = req.body;
    const therapist = await Therapist.findByIdAndUpdate(
      req.user?._id,
      { availability },
      { new: true, runValidators: true }
    ).select('-password');

    return res.json({ therapist });
  } catch (error) {
    return next(error);
  }
});

// Get therapist appointments
router.get('/appointments', requireTherapist, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, date, page = 1, limit = 10 } = req.query;
    const filter: any = { therapist: req.user?._id };

    if (status) {
      filter.status = status;
    }

    if (date) {
      filter.date = new Date(date as string);
    }

    const appointments = await Appointment.find(filter)
      .populate('user', 'firstName lastName email')
      .sort({ date: 1, startTime: 1 })
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string));

    const total = await Appointment.countDocuments(filter);

    return res.json({
      appointments,
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total
    });
  } catch (error) {
    return next(error);
  }
});

// Update appointment status
router.put('/appointments/:id/status', [
  requireTherapist,
  body('status').isIn(['confirmed', 'cancelled', 'completed', 'no-show']),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('cancellationReason').optional().trim().isLength({ max: 500 })
], async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status, notes, cancellationReason } = req.body;

    const appointment = await Appointment.findOne({
      _id: req.params.id,
      therapist: req.user?._id
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    appointment.status = status;
    if (notes) appointment.notes = notes;
    if (cancellationReason) appointment.cancellationReason = cancellationReason;

    await appointment.save();

    return res.json({ message: 'Appointment status updated successfully', appointment });
  } catch (error) {
    return next(error);
  }
});

// Get dashboard stats
router.get('/dashboard', requireTherapist, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const [
      totalAppointments,
      pendingAppointments,
      completedThisMonth,
      totalEarnings
    ] = await Promise.all([
      Appointment.countDocuments({ therapist: req.user?._id }),
      Appointment.countDocuments({ therapist: req.user?._id, status: 'pending' }),
      Appointment.countDocuments({
        therapist: req.user?._id,
        status: 'completed',
        date: { $gte: startOfMonth, $lte: endOfMonth }
      }),
      Appointment.aggregate([
        { $match: { therapist: req.user?._id, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    return res.json({
      totalAppointments,
      pendingAppointments,
      completedThisMonth,
      totalEarnings: totalEarnings[0]?.total || 0
    });
  } catch (error) {
    return next(error);
  }
});

// Get analytics
router.get('/analytics', requireTherapist, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { period = 'month' } = req.query;
    const therapistId = req.user?._id;
    
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
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        break;
      case 'month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const labelFormat = (d: Date): string => {
        const date = new Date(d);
        if (period === 'week' || period === 'month') return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (period === 'year' || period ==='quarter') return date.toLocaleDateString('en-US', { month: 'long' });
        return date.toLocaleDateString();
    }

    const appointmentsInRange = await Appointment.find({
      therapist: therapistId,
      date: { $gte: startDate },
    }).populate('user', 'firstName lastName');

    // Earnings and Appointments Data
    const earningsData = new Map<string, number>();
    const appointmentsData = new Map<string, number>();

    appointmentsInRange.forEach(app => {
        const key = labelFormat(new Date(app.date));
        if (app.status === 'completed') {
            earningsData.set(key, (earningsData.get(key) || 0) + app.amount);
        }
        appointmentsData.set(key, (appointmentsData.get(key) || 0) + 1);
    });
    
    const sortedEarnings = [...earningsData.entries()].sort((a,b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
    const sortedAppointments = [...appointmentsData.entries()].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());

    // Client Stats
    const clientIds = [...new Set(
      appointmentsInRange
        .map(app => app.user?._id?.toString())
        .filter(id => id) as string[]
    )];
    
    const [newClientIds, averageRatingResult] = await Promise.all([
      clientIds.length > 0 ? Appointment.aggregate([
        { $match: { user: { $in: clientIds.map(id => new mongoose.Types.ObjectId(id)) } } },
        { $group: { _id: '$user', firstAppointment: { $min: '$date' } } },
        { $match: { firstAppointment: { $gte: startDate } } },
        { $project: { _id: 1 } }
      ]) : Promise.resolve([]),
      Appointment.aggregate([
        { $match: { therapist: therapistId, status: 'completed', rating: { $exists: true, $ne: null } } },
        { $group: { _id: null, avgRating: { $avg: '$rating' } } }
      ])
    ]);
    
    const newClientsCount = newClientIds.length;
    
    // Session Types
    const sessionTypes = new Map<string, number>();
    appointmentsInRange.forEach(app => {
        if(app.sessionType)
        sessionTypes.set(app.sessionType, (sessionTypes.get(app.sessionType) || 0) + 1);
    });

    // Monthly Trends (for year view)
    let monthlyTrends: { labels: string[]; appointments: number[]; earnings: number[] } = { labels: [], appointments: [], earnings: [] };
    if (period === 'year') {
      const monthlyData = await Appointment.aggregate([
          { $match: { therapist: therapistId, date: { $gte: startDate }, status: 'completed' } },
          {
              $group: {
                  _id: { $month: '$date' },
                  totalAppointments: { $sum: 1 },
                  totalEarnings: { $sum: '$amount' }
              }
          },
          { $sort: { '_id': 1 } }
      ]);

      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      monthlyTrends.labels = monthlyData.map(d => monthNames[d._id - 1]);
      monthlyTrends.appointments = monthlyData.map(d => d.totalAppointments);
      monthlyTrends.earnings = monthlyData.map(d => d.totalEarnings);
    }

    res.json({
        earnings: {
            labels: sortedEarnings.map(e => e[0]),
            data: sortedEarnings.map(e => e[1])
        },
        appointments: {
            labels: sortedAppointments.map(a => a[0]),
            data: sortedAppointments.map(a => a[1])
        },
        clientStats: {
            totalClients: clientIds.length,
            newClients: newClientsCount,
            returningClients: clientIds.length - newClientsCount,
            averageRating: averageRatingResult[0]?.avgRating || 0
        },
        sessionTypes: {
            labels: [...sessionTypes.keys()],
            data: [...sessionTypes.values()]
        },
        monthlyTrends: monthlyTrends,
    });
  } catch (error) {
    next(error);
  }
});

export default router; 