// Change User Data Script for Black Hole Chat V2
// Run with: node changedata.js

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('readline');

// MongoDB Connection String
const MONGODB_URI = process.env.MONGODB_URI;

// Create readline interface for terminal input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Define User Schema (must match server.js)
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    rank: { 
        type: String, 
        enum: ['owner', 'admin', 'moderator', 'vip', 'member'],
        default: 'member'
    },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date },
    isVerified: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    avatar: { type: String, default: null },
    theme: { type: String, default: 'default' },
    deviceIds: [{ type: String }]
});

let User;
let isConnected = false;

// Available ranks for selection
const RANKS = ['owner', 'admin', 'moderator', 'vip', 'member'];

// Promisify question function
function question(query) {
    return new Promise((resolve) => {
        rl.question(query, resolve);
    });
}

// Connect to MongoDB
async function connectToMongoDB() {
    try {
        console.log('\n🔌 Connecting to MongoDB...');
        console.log('📊 Using URI:', MONGODB_URI.replace(/\/\/[^@]+@/, '//****:****@')); // Hide credentials in log
        
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000
        });
        
        isConnected = true;
        console.log('✅✅✅ Connected to MongoDB successfully!');
        
        // Initialize User model
        User = mongoose.model('User', UserSchema);
        
        return true;
    } catch (err) {
        console.error('❌❌❌ MongoDB connection failed:', err.message);
        return false;
    }
}

// List all users in database
async function listAllUsers() {
    try {
        const users = await User.find({}).select('-password').lean();
        
        console.log('\n' + '='.repeat(80));
        console.log('📋 CURRENT USERS IN DATABASE:');
        console.log('='.repeat(80));
        
        if (users.length === 0) {
            console.log('No users found in database.');
            return;
        }
        
        users.forEach((user, index) => {
            console.log(`\n${index + 1}. Username: ${user.username}`);
            console.log(`   Full Name: ${user.fullName}`);
            console.log(`   Email: ${user.email}`);
            console.log(`   Rank: ${user.rank}`);
            console.log(`   Verified: ${user.isVerified ? '✅ Yes' : '❌ No'}`);
            console.log(`   Banned: ${user.isBanned ? '⛔ Yes' : '✅ No'}`);
            console.log(`   Created: ${new Date(user.createdAt).toLocaleString()}`);
            console.log(`   Last Login: ${user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}`);
            console.log(`   Theme: ${user.theme}`);
            console.log('-'.repeat(40));
        });
        
        console.log(`\n📊 Total Users: ${users.length}`);
        
    } catch (err) {
        console.error('❌ Error listing users:', err.message);
    }
}

// Find user by username
async function findUser(username) {
    try {
        const user = await User.findOne({ username }).lean();
        return user;
    } catch (err) {
        console.error('❌ Error finding user:', err.message);
        return null;
    }
}

// Update user information
async function updateUser(username, updates) {
    try {
        const result = await User.updateOne(
            { username },
            { $set: updates }
        );
        
        if (result.matchedCount === 0) {
            console.log(`❌ User '${username}' not found.`);
            return false;
        }
        
        console.log(`✅ User '${username}' updated successfully!`);
        console.log(`📝 Modified ${result.modifiedCount} field(s).`);
        return true;
    } catch (err) {
        console.error('❌ Error updating user:', err.message);
        return false;
    }
}

// Delete user
async function deleteUser(username) {
    try {
        const result = await User.deleteOne({ username });
        
        if (result.deletedCount === 0) {
            console.log(`❌ User '${username}' not found.`);
            return false;
        }
        
        console.log(`✅ User '${username}' deleted successfully!`);
        return true;
    } catch (err) {
        console.error('❌ Error deleting user:', err.message);
        return false;
    }
}

// Change user password
async function changePassword(username, newPassword) {
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const result = await User.updateOne(
            { username },
            { $set: { password: hashedPassword } }
        );
        
        if (result.matchedCount === 0) {
            console.log(`❌ User '${username}' not found.`);
            return false;
        }
        
        console.log(`✅ Password changed for user '${username}'!`);
        return true;
    } catch (err) {
        console.error('❌ Error changing password:', err.message);
        return false;
    }
}

// Main menu
async function showMainMenu() {
    console.log('\n' + '='.repeat(60));
    console.log('🔧 BLACK HOLE CHAT V2 - USER DATA MANAGEMENT');
    console.log('='.repeat(60));
    console.log('1. 📋 List all users');
    console.log('2. 🔍 Find user by username');
    console.log('3. ✏️ Edit user information');
    console.log('4. 🗑️ Delete user');
    console.log('5. 🔐 Change user password')
    console.log('6. 🚪 Exit');
    console.log('='.repeat(60));
    
    const choice = await input('Select an option (1-6): ');
    return choice.trim();
}