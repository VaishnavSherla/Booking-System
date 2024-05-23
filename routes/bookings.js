const express = require('express');
const router = express.Router();
const pool = require('../db');
const bookingSchema = require('../schemas/bookingSchema');
const auth = require('../middlewares/auth');

// Create Booking
router.post('/', auth, async (req, res) => {
    const client = await pool.connect();
    try {
        const { error } = bookingSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { flight_id, seat_id } = req.body;
        const user_id = req.user.userId;

        // Start a transaction
        await client.query('BEGIN');
        
        // Check if the selected seat is available and obtain a lock
        const checkSeatQuery = 'SELECT * FROM seats WHERE seat_id = $1 AND seat_status = TRUE FOR UPDATE';
        const result = await client.query(checkSeatQuery, [seat_id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Seat already booked' });
        }

        const insertBookingQuery = `
            INSERT INTO bookings (user_id, flight_id, seat_id, booking_time) 
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP) 
            RETURNING *
        `;
        const newBooking = await client.query(insertBookingQuery, [user_id, flight_id, seat_id]);

        const updateSeatQuery = 'UPDATE seats SET seat_status = $1 WHERE seat_id = $2';
        const changeStatus = await client.query(updateSeatQuery, [false, seat_id]);

        if (newBooking.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Seat already booked' });
        }

        if (changeStatus.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Seat already booked' });
        }

        await client.query('COMMIT');
        res.json(newBooking.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// Read Booking
router.get('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [id]);

        if (booking.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        res.json(booking.rows[0]);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;