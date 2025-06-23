import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import User from '../models/User';
import Therapist from '../models/Therapist';
import Admin from '../models/Admin';
import { createError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();

// Generate JWT Token
const generateToken = (userId: string, userType: string): string => {
  return jwt.sign(
    { userId, userType },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: '7d' }
  );
};

// User Registration
router.post('/register/user', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('firstName').trim().isLength({ min: 2, max: 50 }),
  body('lastName').trim().isLength({ min: 2, max: 50 }),
  body('phone').optional().isMobilePhone('any'),
  body('dateOfBirth').optional().isISO8601(),
  body('gender').optional().isIn(['male', 'female', 'other', 'prefer-not-to-say'])
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, firstName, lastName, phone, dateOfBirth, gender } = req.body;

    // Check if user already exists
    let user = await User.findOne({ email }).exec();
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user
    user = new User({
      email,
      password,
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender
    });

    await user.save();

    const token = generateToken((user._id as any).toString(), 'user');

    return res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: 'user'
      }
    });
  } catch (error) {
    return next(error);
  }
});

// Therapist Registration
router.post('/register/therapist', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('firstName').trim().isLength({ min: 2, max: 50 }),
  body('lastName').trim().isLength({ min: 2, max: 50 }),
  body('licenseNumber').trim().notEmpty(),
  body('specializations').isArray({ min: 1 }),
  body('education').isArray({ min: 1 }),
  body('education.*.degree').notEmpty().withMessage('Degree is required'),
  body('education.*.institution').notEmpty().withMessage('Institution is required'),
  body('education.*.year').isNumeric().withMessage('Year must be a number'),
  body('experience').isInt({ min: 0 }),
  body('bio').trim().isLength({ min: 50, max: 1000 }),
  body('hourlyRate').isFloat({ min: 0 }),
  body('languages').isArray({ min: 1 })
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      email, password, firstName, lastName, licenseNumber,
      specializations, education, experience, bio, hourlyRate, languages
    } = req.body;

    // Check if therapist already exists
    const existingTherapist = await Therapist.findOne({ 
      $or: [{ email }, { licenseNumber }] 
    });
    if (existingTherapist) {
      return res.status(400).json({ message: 'Therapist already exists with this email or license number' });
    }

    // Create new therapist
    const therapist = new Therapist({
      email,
      password,
      firstName,
      lastName,
      licenseNumber,
      specializations,
      education,
      experience,
      bio,
      hourlyRate,
      languages
    });

    await therapist.save();

    // Generate token
    const token = generateToken((therapist._id as any).toString(), 'therapist');

    return res.status(201).json({
      message: 'Therapist registered successfully',
      token,
      therapist: {
        id: therapist._id,
        email: therapist.email,
        firstName: therapist.firstName,
        lastName: therapist.lastName,
        userType: 'therapist'
      }
    });
  } catch (error) {
    return next(error);
  }
});

// Admin Registration (only super-admin can create other admins)
router.post('/register/admin', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('firstName').trim().isLength({ min: 2, max: 50 }),
  body('lastName').trim().isLength({ min: 2, max: 50 }),
  body('role').isIn(['admin', 'moderator']),
  body('permissions').isArray()
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, firstName, lastName, role, permissions } = req.body;

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({ message: 'Admin already exists with this email' });
    }

    // Create new admin
    const admin = new Admin({
      email,
      password,
      firstName,
      lastName,
      role,
      permissions
    });

    await admin.save();

    // Generate token
    const token = generateToken((admin._id as any).toString(), 'admin');

    return res.json({
      token,
      admin: {
        id: admin._id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        userType: 'admin'
      }
    });
  } catch (error) {
    return next(error);
  }
});

// Login (Universal for all user types)
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  body('userType').isIn(['user', 'therapist', 'admin'])
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, userType } = req.body;

    let user;
    let Model;

    switch (userType) {
      case 'user':
        Model = User;
        break;
      case 'therapist':
        Model = Therapist;
        break;
      case 'admin':
        Model = Admin;
        break;
      default:
        return res.status(400).json({ message: 'Invalid user type' });
    }

    // Find user
    user = await (Model as any).findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken((user._id as any).toString(), userType);

    // Sanitize user data for response
    const userForResponse = {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: userType,
      ...(userType === 'admin' && { role: user.role, permissions: user.permissions }),
      ...(userType === 'therapist' && { isVerified: user.isVerified, specializations: user.specializations })
    };

    return res.json({
      token,
      user: userForResponse
    });
  } catch (error) {
    return next(error);
  }
});

// Get current user
router.get('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    return res.json({
      user: req.user,
      userType: req.userType
    });
  } catch (error) {
    return next(error);
  }
});

// Therapist login
router.post('/login/therapist', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Check if therapist exists
    const therapist = await Therapist.findOne({ email }).exec();
    if (!therapist) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await therapist.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken((therapist._id as any).toString(), 'therapist');

    return res.json({
      token,
      therapist: {
        id: therapist._id,
        email: therapist.email,
        firstName: therapist.firstName,
        lastName: therapist.lastName,
        userType: 'therapist'
      }
    });
  } catch (error) {
    return next(error);
  }
});

// Admin login
router.post('/login/admin', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Check if admin exists
    const admin = await Admin.findOne({ email }).exec();
    if (!admin) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken((admin._id as any).toString(), 'admin');

    return res.json({
      token,
      admin: {
        id: admin._id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        userType: 'admin'
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router; 