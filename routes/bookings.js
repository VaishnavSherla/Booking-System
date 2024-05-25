const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const redis = require('../redis');
const bookingSchema = require('../schemas/bookingSchema');
const auth = require('../middlewares/auth');

const RESERVATION_TTL = 600; // 10 minutes in seconds

// Reserve a seat (holds it in Redis for TTL seconds, no DB write yet)
router.post('/reserve', auth, async (req, res) => {
    const { seat_id, flight_id } = req.body;
    if (!seat_id || !flight_id) {
        return res.status(400).json({ error: 'seat_id and flight_id are required' });
    }

    const user_id = req.user.userId;
    const client = await pool.connect();
    try {
        // Check seat is still available in DB (no lock needed — just a quick read)
        const seatCheck = await client.query(
            'SELECT seat_id FROM seats WHERE seat_id = $1 AND seat_status = TRUE',
            [seat_id]
        );
        if (seatCheck.rows.length === 0) {
            return res.status(409).json({ error: 'Seat is not available' });
        }

        // Atomically claim the seat in Redis (NX = only set if key does not exist)
        const reservationId = uuidv4();
        const lockKey = `seat_lock:${seat_id}`;
        const lockValue = `${user_id}:${reservationId}`;

        const acquired = await redis.set(lockKey, lockValue, { NX: true, EX: RESERVATION_TTL });
        if (!acquired) {
            return res.status(409).json({ error: 'Seat is currently held by another user, try again shortly' });
        }

        // Store reservation metadata so /confirm can look it up
        await redis.set(
            `reservation:${reservationId}`,
            JSON.stringify({ seat_id, flight_id, user_id }),
            { EX: RESERVATION_TTL }
        );

        res.json({ reservation_id: reservationId, expires_in_seconds: RESERVATION_TTL });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// Confirm a reservation (validates Redis hold, then writes to DB)
router.post('/confirm', auth, async (req, res) => {
    const { reservation_id } = req.body;
    if (!reservation_id) {
        return res.status(400).json({ error: 'reservation_id is required' });
    }

    const user_id = req.user.userId;

    // Look up reservation metadata
    const reservationRaw = await redis.get(`reservation:${reservation_id}`);
    if (!reservationRaw) {
        return res.status(410).json({ error: 'Reservation expired or not found — seat has been released' });
    }

    const { seat_id, flight_id } = JSON.parse(reservationRaw);

    // Verify this user still owns the seat lock
    const lockKey = `seat_lock:${seat_id}`;
    const lockValue = await redis.get(lockKey);
    if (!lockValue || lockValue !== `${user_id}:${reservation_id}`) {
        return res.status(403).json({ error: 'Reservation does not belong to this user' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Final DB-level check with row lock to guard against edge cases
        const seatCheck = await client.query(
            'SELECT seat_id FROM seats WHERE seat_id = $1 AND seat_status = TRUE FOR UPDATE',
            [seat_id]
        );
        if (seatCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Seat is no longer available' });
        }

        const newBooking = await client.query(
            `INSERT INTO bookings (user_id, flight_id, seat_id, booking_time)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *`,
            [user_id, flight_id, seat_id]
        );

        await client.query('UPDATE seats SET seat_status = FALSE WHERE seat_id = $1', [seat_id]);

        await client.query('COMMIT');

        // Release Redis keys — seat is now permanently booked in DB
        await redis.del(lockKey);
        await redis.del(`reservation:${reservation_id}`);

        res.json(newBooking.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// Create Booking (original single-step — kept for backward compatibility)
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