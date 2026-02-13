require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

console.log('🔍 TESTING MONGODB CONNECTION');
console.log('==============================');
console.log('URI:', MONGODB_URI ? MONGODB_URI.replace(/:[^:@]*@/, ':****@') : 'NOT SET');
console.log('');

async function testConnection() {
  try {
    console.log('Connecting...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅ SUCCESS! Connected to MongoDB');
    console.log('Database:', mongoose.connection.name);
    console.log('Host:', mongoose.connection.host);
    process.exit(0);
  } catch (err) {
    console.error('❌ FAILED!');
    console.error('Error Code:', err.code);
    console.error('Error Name:', err.name);
    console.error('Error Message:', err.message);
    
    if (err.message.includes('Authentication failed')) {
      console.log('\n🔑 FIX: Username/Password issue');
      console.log('   Make sure password has %40 instead of @');
    }
    if (err.message.includes('getaddrinfo')) {
      console.log('\n🌐 FIX: Cluster name issue');
      console.log('   Should be: cluster0.j2qik61.mongodb.net');
    }
    if (err.message.includes('timed out')) {
      console.log('\n🔓 FIX: Network Access issue');
      console.log('   Add 0.0.0.0/0 to MongoDB Atlas Network Access');
    }
    process.exit(1);
  }
}

testConnection();