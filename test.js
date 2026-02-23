const axios = require('axios');

const EMAILJS_SERVICE_ID = 'blackchat_conformation_2'; // Updated service ID
const EMAILJS_TEMPLATE_ID = 'template_nngetk9';
const EMAILJS_PUBLIC_KEY = 'Zi5I8MmdRUaaatDte';
const EMAILJS_PRIVATE_KEY = '2m1Wd-AWA0iuceSRaurt6';

async function sendEmail() {
    try {
        const response = await axios.post('https://api.emailjs.com', {
            service_id: EMAILJS_SERVICE_ID,
            template_id: EMAILJS_TEMPLATE_ID,
            user_id: EMAILJS_PUBLIC_KEY,
            accessToken: EMAILJS_PRIVATE_KEY, 
            template_params: {
                to_email: 'misha037@hsd.k12.or.us',
                subject: 'Test Subject',
                message: 'This is a test message.'
            }
        });
        console.log('Email sent successfully:', response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

sendEmail();
