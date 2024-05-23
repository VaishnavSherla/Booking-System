const express = require('express');
const path = require('path');
const config = require('config');

const userRoutes = require('./routes/user');
const flightRoutes = require('./routes/flights');
const seatRoutes = require('./routes/seats');
const bookingRoutes = require('./routes/bookings');
const airCraftRoutes = require('./routes/aircraft');

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/flights', flightRoutes);
app.use('/api/seats', seatRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/aircraft', airCraftRoutes);

app.use(express.static(path.join(__dirname, 'public')));

// Start server
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
