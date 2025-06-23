import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import Appointment from '../models/Appointment';
import Therapist from '../models/Therapist';
import { requireUser, requireTherapist, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Book appointment
router.post('/book', [
  requireUser,
  body('therapistId').isMongoId(),
  body('date').isISO8601(),
  body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('duration').isInt({ min: 30, max: 180 }),
  body('sessionType').isIn(['individual', 'group', 'couple']),
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

    res.status(201).json({
      message: 'Appointment booked successfully',
      appointment
    });
  } catch (error) {
    return next(error);
  }
});

// Get appointments (for therapists)
router.get('/therapist', requireTherapist, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.put('/:id/status', [
  requireTherapist,
  body('status').isIn(['confirmed', 'cancelled', 'completed', 'no-show'])
], async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status } = req.body;

    const appointment = await Appointment.findOneAndUpdate(
      {
        _id: req.params.id,
        therapist: req.user?._id
      },
      { status },
      { new: true }
    ).populate('user', 'firstName lastName email');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    return res.json({ appointment });
  } catch (error) {
    return next(error);
  }
});

// Cancel appointment
router.put('/:id/cancel', requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const appointment = await Appointment.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.user?._id,
        status: { $in: ['pending', 'confirmed'] }
      },
      { status: 'cancelled' },
      { new: true }
    ).populate('therapist', 'firstName lastName');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found or cannot be cancelled' });
    }

    return res.json({ appointment });
  } catch (error) {
    return next(error);
  }
});

// Get available time slots for a therapist
router.get('/available-slots/:therapistId', requireUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { date } = req.query;
    const { therapistId } = req.params;

    if (!date) {
      return res.status(400).json({ message: 'Date is required' });
    }

    const selectedDate = new Date(date as string);
    const dayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });

    // Get therapist availability for this day
    const therapist = await Therapist.findById(therapistId);
    if (!therapist) {
      return res.status(404).json({ message: 'Therapist not found' });
    }

    // Get booked slots for this date
    const bookedSlots = await Appointment.find({
      therapist: therapistId,
      date: selectedDate,
      status: { $in: ['confirmed', 'pending'] }
    }).select('startTime endTime');

    const bookedTimeSlots = bookedSlots.map(slot => (slot as any).startTime);

    // Generate available slots (9 AM to 6 PM, 1-hour intervals)
    const availableSlots = [];
    for (let hour = 9; hour < 18; hour++) {
      const timeSlot = `${hour.toString().padStart(2, '0')}:00`;
      if (!bookedTimeSlots.includes(timeSlot)) {
        availableSlots.push({
          startTime: timeSlot,
          endTime: `${(hour + 1).toString().padStart(2, '0')}:00`
        });
      }
    }

    return res.json({ availableSlots });
  } catch (error) {
    return next(error);
  }
});

export default router; 