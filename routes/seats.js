const express = require('express');
const router = express.Router();
const pool = require('../db');
const seatSchema = require('../schemas/seatSchema');
const Joi = require('joi');
const auth = require('../middlewares/auth')

// Get Seats for a Specific Flight with date
router.get('/:flight_id/:date', auth, async (req, res) => {
    try {
        const { error, value } = Joi.object({
            flight_id: Joi.number().integer().required(),
            date: Joi.date().optional()
        }).validate(req.params);

        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { flight_id, date } = value;

        let parsedDate;
        if (date) {
            parsedDate = new Date(date);
        } else {
            parsedDate = new Date();
        }

        const seats = await pool.query(
            `SELECT seats.*, flights.flight_number, flights.departure_airport, flights.destination_airport
             FROM seats
             JOIN flights ON seats.flight_id = flights.flight_id
             WHERE seats.flight_id = $1 AND $2 BETWEEN flights.departure_time::date AND flights.arrival_time::date`,
            [flight_id, parsedDate]
        );

        res.json(seats.rows);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Read Seat
router.get('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;

        const seat = await pool.query('SELECT * FROM seats WHERE seat_id = $1', [id]);

        if (seat.rows.length === 0) {
            return res.status(404).json({ error: 'Seat not found' });
        }

        res.json(seat.rows[0]);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Update Seat
router.put('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { flight_id, seat_number, seat_status } = req.body;

        const updatedSeat = await pool.query(
            'UPDATE seats SET flight_id = $1, seat_number = $2, seat_status = $3 WHERE seat_id = $4 RETURNING *',
            [flight_id, seat_number, seat_status, id]
        );

        if (updatedSeat.rows.length === 0) {
            return res.status(404).json({ error: 'Seat not found' });
        }
        
        res.json(updatedSeat.rows[0]);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
