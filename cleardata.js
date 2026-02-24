// Reset Database with Default Data
// Run with: node reset-with-defaults.js

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://livechatdb:A%40sh1shmongodb@cluster0.j2qik61.mongodb.net/blackholechat?retryWrites=true&w=majority';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'A@sh1shlivechat';
const OWNER_USERNAME = process.env.OWNER_USERNAME || 'Pi_Kid71';
const OWNER_FULLNAME = process.env.OWNER_FULLNAME || 'Aashish Mishra'; // email no longer used

console.log('\n' + '='.repeat(60));
console.log('🔄 RESET DATABASE WITH DEFAULTS');
console.log('='.repeat(60));

// Define schemas
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  fullName: { type: String, required: true },
  // email removed
  password: { type: String, required: true },
  rank: { type: String, enum: ['owner', 'admin', 'moderator', 'vip', 'member'], default: 'member' },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  theme: { type: String, default: 'default' }
});

const RoomSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  password: { type: String, default: '' },
  isDefault: { type: Boolean, default: false },
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  theme: { type: String, default: 'default' }
});

async function resetDatabase() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Connected to MongoDB');
    
    // Drop all collections
    const collections = await mongoose.connection.db.collections();
    for (let collection of collections) {
      await collection.drop();
      console.log(`   ✅ Dropped: ${collection.collectionName}`);
    }

    // recreate owner account
    const User = mongoose.model('User', UserSchema);
    const existing = await User.findOne({ username: OWNER_USERNAME });
    if (!existing) {
      const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await User.create({
        username: OWNER_USERNAME,
        fullName: OWNER_USERNAME,
        password: hashed,
        rank: 'owner',
        isVerified: false
      });
      console.log(`   ✅ Created default owner account: ${OWNER_USERNAME}`);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
    process.exit(0);
  }
}

resetDatabase();