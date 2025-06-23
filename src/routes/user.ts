import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import User from '../models/User';
import Therapist from '../models/Therapist';
import Appointment from '../models/Appointment';
import { requireUser, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Get user profile
router.get('/profile', requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?._id).select('-password');
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// Update user profile
router.put('/profile', upload.single('profileImage'), requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const updates: any = {};
    
    // Handle file upload
    if (req.file) {
      updates.profileImage = req.file.path;
    }

    // Handle other fields
    for (const key in req.body) {
      if (key === 'emergencyContact' || key === 'preferences') {
        updates[key] = JSON.parse(req.body[key]);
      } else {
        updates[key] = req.body[key];
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user?._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    return res.json({ user });
  } catch (error) {
    return next(error);
  }
});

// Change password
router.put('/change-password', [
  requireUser,
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
], async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user?._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    user.password = hashedPassword;
    await user.save();

    return res.json({ message: 'Password changed successfully' });
  } catch (error) {
    return next(error);
  }
});

// Browse therapists
router.get('/therapists', requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      search,
      specialization,
      language,
      minRating,
      maxPrice,
      availability,
      page = 1,
      limit = 10
    } = req.query;

    const filter: any = { isActive: true, isVerified: true };
    const andConditions = [filter];

    if (search) {
      const searchRegex = new RegExp(search as string, 'i'); // 'i' for case-insensitive
      andConditions.push({
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { bio: searchRegex },
        ]
      });
    }

    if (specialization) {
      andConditions.push({ specializations: { $in: [specialization] } });
    }

    if (language) {
      andConditions.push({ languages: { $in: [language] } });
    }

    if (minRating) {
      andConditions.push({ rating: { $gte: parseFloat(minRating as string) } });
    }

    if (maxPrice) {
      andConditions.push({ hourlyRate: { $lte: parseFloat(maxPrice as string) } });
    }

    const finalFilter = { $and: andConditions };

    const therapists = await Therapist.find(finalFilter)
      .select('-password')
      .limit(parseInt(limit as string) * 1)
      .skip((parseInt(page as string) - 1) * parseInt(limit as string))
      .sort({ rating: -1, totalSessions: -1 });

    const total = await Therapist.countDocuments(finalFilter);

    return res.json({
      therapists,
      totalPages: Math.ceil(total / parseInt(limit as string)),
      currentPage: parseInt(page as string),
      total
    });
  } catch (error) {
    return next(error);
  }
});

// Get therapist details
router.get('/therapists/:id', requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const therapist = await Therapist.findById(req.params.id)
      .select('-password')
      .populate('reviews');

    if (!therapist) {
      return res.status(404).json({ message: 'Therapist not found' });
    }

    return res.json({ therapist });
  } catch (error) {
    return next(error);
  }
});

// Get user appointments
router.get('/appointments', requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const filter: any = { user: req.user?._id };

    if (status) {
      filter.status = status;
    }

    const appointments = await Appointment.find(filter)
      .populate('therapist', 'firstName lastName specializations rating')
      .sort({ date: -1 })
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

// Get appointment details
router.get('/appointments/:id', requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      user: req.user?._id
    }).populate('therapist', 'firstName lastName specializations');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    return res.json({ appointment });
  } catch (error) {
    return next(error);
  }
});

// Rate and review appointment
router.post('/appointments/:id/review', [
  requireUser,
  body('rating').isInt({ min: 1, max: 5 }),
  body('review').optional().trim().isLength({ max: 1000 })
], async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { rating, review } = req.body;

    const appointment = await Appointment.findOne({
      _id: req.params.id,
      user: req.user?._id,
      status: 'completed'
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found or not completed' });
    }

    appointment.rating = rating;
    appointment.review = review;
    await appointment.save();

    return res.json({ message: 'Review submitted successfully', appointment });
  } catch (error) {
    return next(error);
  }
});

// Book appointment
router.post('/book-appointment', [
  requireUser,
  body('therapistId').isMongoId(),
  body('date').isISO8601(),
  body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('duration').isInt({ min: 30, max: 180 }),
  body('sessionType').isIn(['individual', 'couple', 'group']),
  body('sessionMode').isIn(['video', 'audio', 'chat', 'in-person']),
  body('notes').optional().trim().isLength({ max: 1000 })
], async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      therapistId,
      date,
      startTime,
      duration,
      sessionType,
      sessionMode,
      notes
    } = req.body;

    // Check if therapist exists and is available
    const therapist = await Therapist.findById(therapistId);
    if (!therapist || !therapist.isActive || !therapist.isVerified) {
      return res.status(404).json({ message: 'Therapist not found or unavailable' });
    }

    // Calculate end time
    const startTimeMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
    const endTimeMinutes = startTimeMinutes + duration;
    const endTime = `${Math.floor(endTimeMinutes / 60).toString().padStart(2, '0')}:${(endTimeMinutes % 60).toString().padStart(2, '0')}`;

    // Check for conflicts
    const conflictingAppointment = await Appointment.findOne({
      therapist: therapistId,
      date: new Date(date),
      status: { $in: ['pending', 'confirmed'] },
      $or: [
        {
          startTime: { $lt: endTime },
          endTime: { $gt: startTime }
        }
      ]
    });

    if (conflictingAppointment) {
      return res.status(400).json({ message: 'Time slot is not available' });
    }

    // Calculate amount
    const amount = (therapist.hourlyRate / 60) * duration;

    // Create appointment
    const appointment = new Appointment({
      user: req.user?._id,
      therapist: therapistId,
      date: new Date(date),
      startTime,
      endTime,
      duration,
      sessionType,
      sessionMode,
      notes,
      amount
    });

    await appointment.save();

    // Populate therapist info for response
    await appointment.populate('therapist', 'firstName lastName specializations rating');

    return res.status(201).json({
      message: 'Appointment booked successfully',
      appointment
    });
  } catch (error) {
    return next(error);
  }
});

export default router; 