// test.js - Fixed for Node.js environment
const axios = require('axios');

const EMAILJS_SERVICE_ID = 'blackchat_conformation';
const EMAILJS_TEMPLATE_ID = 'template_nngetk9';
const EMAILJS_PUBLIC_KEY = 'Zi5I8MmdRUaaatDte';
const EMAILJS_PRIVATE_KEY = '2m1Wd-AWA0iuceSRaurt6';

async function testEmailJS() {
  try {
    console.log('🔍 Testing EmailJS (Server-side)...');
    
    const now = new Date();
    const timeString = now.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit'
    });
    
    // For server-side, we need to use the REST API endpoint
    const response = await axios.post('https://api.emailjs.com/api/v1.0/email/send', {
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: {
        name: 'Test User',
        time: timeString,
        message: 'Your verification code is: 123456',
        to_email: 'misha037@hsd.k12.or.us', // Replace with your actual email
        from_name: 'Black Hole Chat V2',
        reply_to: 'aashishmishra6666@gmail.com'
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://your-app-url.com' // Some servers need this
      }
    });

    console.log('✅ Success!', response.data);
    console.log('📧 Check your email for the test message');
    
  } catch (error) {
    console.error('❌ Failed:');
    if (error.response) {
      // The request was made and the server responded with a status code
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
      console.error('Headers:', error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received:', error.request);
    } else {
      // Something happened in setting up the request
      console.error('Error:', error.message);
    }
  }
}

testEmailJS();