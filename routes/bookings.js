const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const redis = require('../redis');
const bookingSchema = require('../schemas/bookingSchema');
const auth = require('../middlewares/auth');

const RESERVATION_TTL = 600; // 10 minutes in seconds

// Max 1 reserve attempt per user every 30 seconds
const reserveLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 1,
    keyGenerator: (req) => req.user?.userId?.toString() || req.ip,
    handler: (req, res) => res.status(429).json({ error: 'Too many reserve attempts — wait 30 seconds before trying again' }),
    skip: (req) => !req.user // only apply after auth parses the token
});

// Reserve a seat (holds it in Redis for TTL seconds, no DB write yet)
router.post('/reserve', auth, reserveLimiter, async (req, res) => {
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

// Get all bookings for the logged-in user
router.get('/mine', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT b.booking_id, b.booking_time, b.flight_id, b.seat_id,
                    f.flight_number, f.departure_airport, f.destination_airport,
                    f.departure_time, f.arrival_time, f.price,
                    s.seat_number
             FROM bookings b
             JOIN flights f ON b.flight_id = f.flight_id
             JOIN seats s ON b.seat_id = s.seat_id
             WHERE b.user_id = $1
             ORDER BY f.departure_time DESC`,
            [req.user.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Cancel a booking (only if flight hasn't departed yet)
router.delete('/:id', auth, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;

        // Fetch booking + flight departure time, verify it belongs to this user
        const result = await client.query(
            `SELECT b.booking_id, b.seat_id, b.user_id, f.departure_time
             FROM bookings b
             JOIN flights f ON b.flight_id = f.flight_id
             WHERE b.booking_id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const booking = result.rows[0];

        if (booking.user_id !== req.user.userId) {
            return res.status(403).json({ error: 'You can only cancel your own bookings' });
        }

        if (new Date(booking.departure_time) <= new Date()) {
            return res.status(400).json({ error: 'Cannot cancel a booking after the flight has departed' });
        }

        await client.query('BEGIN');
        await client.query('DELETE FROM bookings WHERE booking_id = $1', [id]);
        await client.query('UPDATE seats SET seat_status = TRUE WHERE seat_id = $1', [booking.seat_id]);
        await client.query('COMMIT');

        res.json({ message: 'Booking cancelled and seat released successfully' });
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