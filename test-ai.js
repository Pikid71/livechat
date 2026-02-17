// test-ai.js - Test OpenRouter API using .env file
require('dotenv').config();
const https = require('https');

// Load API key from .env file
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY not found in .env file!');
    console.log('\nPlease add this to your .env file:');
    console.log('OPENROUTER_API_KEY=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');
    process.exit(1);
}

const testAI = async () => {
    console.log('🤖 Testing OpenRouter API connection...');
    console.log('📁 Using API Key from .env file');
    console.log('🔑 API Key:', OPENROUTER_API_KEY.substring(0, 15) + '...');
    console.log('================================\n');
    
    const options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Black Hole Chat Test'
        }
    };

    const requestData = JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
            {
                role: 'user',
                content: 'Say "Hello! The API is working correctly!"'
            }
        ],
        max_tokens: 50
    });

    const req = https.request(options, (res) => {
        console.log('📡 Response Status:', res.statusCode);
        console.log('📡 Status Message:', res.statusMessage);
        
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('\n📦 Full Response:');
            console.log('=================');
            
            if (res.statusCode === 200) {
                try {
                    const jsonData = JSON.parse(data);
                    console.log('✅ SUCCESS! API is working!');
                    console.log('\n🤖 AI Response:', jsonData.choices[0].message.content);
                } catch (e) {
                    console.log('Raw response:', data);
                }
            } else {
                console.log('❌ ERROR - Status Code:', res.statusCode);
                console.log('\nError details:');
                try {
                    const errorData = JSON.parse(data);
                    console.log(JSON.stringify(errorData, null, 2));
                    
                    // Specific error handling
                    if (res.statusCode === 401) {
                        console.log('\n🔑 PROBLEM: Invalid API Key');
                        console.log('   The API key in your .env file is not valid or has expired.');
                        console.log('\n📝 To fix:');
                        console.log('   1. Go to https://openrouter.ai/keys');
                        console.log('   2. Copy your API key (starts with "sk-or-")');
                        console.log('   3. Update your .env file with the new key');
                        console.log('\n   Current .env line should be:');
                        console.log(`   OPENROUTER_API_KEY=your-new-key-here`);
                    } else if (res.statusCode === 429) {
                        console.log('\n⏳ PROBLEM: Rate Limit Exceeded');
                        console.log('   Too many requests. Wait a few minutes and try again.');
                    } else if (res.statusCode === 403) {
                        console.log('\n🚫 PROBLEM: Access Forbidden');
                        console.log('   Your API key does not have permission to use this model.');
                    }
                } catch (e) {
                    console.log('Raw error:', data);
                }
            }
        });
    });

    req.on('error', (error) => {
        console.error('\n❌ Network Error:', error.message);
    });

    req.write(requestData);
    req.end();
};

// Run the test
testAI();