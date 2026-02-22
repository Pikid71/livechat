// 1. Initialize EmailJS with your Public Key
// (Find this in Account > API Keys)
emailjs.init({
  publicKey: "YOUR_PUBLIC_KEY",
});

// 2. Define the test function
function runEmailTest() {
  // These keys must match the {{variable_names}} in your EmailJS template
  const templateParams = {
    to_name: "Tester",
    message: "If you see this, EmailJS is working perfectly!",
    from_name: "My App Test"
  };

  // 3. Send the email
  emailjs.send('YOUR_SERVICE_ID', 'YOUR_TEMPLATE_ID', templateParams)
    .then((response) => {
      console.log('SUCCESS!', response.status, response.text);
      alert('Test Email Sent!');
    })
    .catch((error) => {
      console.error('FAILED...', error);
      alert('Check the console for error details.');
    });
}

// 4. Run the test (you can also hook this to a button click)
runEmailTest();
