const { createApp } = require('./src/app');
const port = process.env.PORT || 3000;
createApp().listen(port, () => console.log(`Watermark listening on ${port}`));
