import mongoose from 'mongoose';
import Admin from './models/Admin';

const seedDatabase = async () => {
  // Make sure to have a .env file in the 'backend' directory with your MONGODB_URI
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error('Error: MONGODB_URI is not defined. Please create a .env file in the /backend directory with your MongoDB connection string.');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB for seeding.');

    const adminDetails = {
      email: 'gopal@gmail.com',
      password: 'gopal@123',
      firstName: 'gopal',
      lastName: 'Krishna',
      role: 'admin' as const,
      permissions: [
        'manage_users',
        'manage_therapists',
        'manage_admins',
        'view_analytics',
        'manage_content',
        'manage_appointments',
        'view_chat_logs'
      ]
    };

    // Find the admin by email
    const adminExists = await Admin.findOne({ email: adminDetails.email });

    if (adminExists) {
      // If admin exists, we will delete it to ensure the password is set correctly.
      // The 'save' hook will then hash the new password.
      await Admin.deleteOne({ email: adminDetails.email });
      console.log(`Removed existing admin: ${adminDetails.email}`);
    }

    // Create a new admin instance
    const admin = new Admin(adminDetails);

    // The 'pre-save' hook on the Admin model will hash the password
    await admin.save();
    
    console.log('Admin user seeded successfully!');
    console.log(`Email: ${adminDetails.email}`);
    console.log(`Password: ${adminDetails.password}`);

  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
};

seedDatabase(); 