import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Therapist from '../models/Therapist';
import Admin from '../models/Admin';

export interface AuthRequest extends Request {
  user?: any;
  userType?: 'user' | 'therapist' | 'admin';
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  console.log(`[AUTH] Middleware triggered for: ${req.method} ${req.originalUrl}`);
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      console.log('[AUTH] No token provided.');
      res.status(401).json({ message: 'No token, authorization denied' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as { userId: string; userType: 'user' | 'therapist' | 'admin' };
    
    console.log(`[AUTH] Decoded Token: userId=${decoded.userId}, userType=${decoded.userType}`);

    if (!decoded.userId || !decoded.userType) {
      console.log('[AUTH] Token missing required data.');
      res.status(401).json({ message: 'Token is missing required data' });
      return;
    }

    let user;
    const { userId, userType } = decoded;

    switch (userType) {
      case 'user':
        user = await User.findById(userId).select('-password');
        break;
      case 'therapist':
        user = await Therapist.findById(userId).select('-password');
        break;
      case 'admin':
        user = await Admin.findById(userId).select('-password');
        break;
      default:
        res.status(401).json({ message: 'Invalid user type in token' });
        return;
    }

    if (!user) {
      console.log(`[AUTH] User not found in database. UserID: ${userId}, UserType: ${userType}`);
      res.status(401).json({ message: 'Token is not valid, user not found' });
      return;
    }

    console.log(`[AUTH] User authenticated successfully. Role: ${userType}`);
    req.user = user;
    req.userType = userType;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
    return;
  }
};

export const requireUser = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ message: 'Access denied' });
    return;
  }
  next();
};

export const requireTherapist = (req: AuthRequest, res: Response, next: NextFunction): void => {
  console.log(`[AUTH] requireTherapist check. User type is: ${req.userType}`);
  if (!req.user || req.userType !== 'therapist') {
    res.status(403).json({ message: 'Access denied. Therapist only.' });
    return;
  }
  next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  console.log(`[AUTH] requireAdmin check. User type is: ${req.userType}`);
  if (!req.user || req.userType !== 'admin') {
    res.status(403).json({ message: 'Access denied. Admin only.' });
    return;
  }
  next();
};

export const requireRole = (roles: ('user' | 'therapist' | 'admin')[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Access denied' });
      return;
    } else if (!req.userType || !roles.includes(req.userType)) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }
    next();
  };
}; 