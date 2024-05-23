const express = require('express');
const router = express.Router();
const pool = require('../db');
const flightSchema = require('../schemas/flightSchema');
const Joi = require('joi');
const auth = require('../middlewares/auth')
const admin = require('../middlewares/admin')

// Create Flight
router.post('/', [auth, admin], async (req, res) => {
    const client = await pool.connect();
    try {
        const { error } = flightSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            flight_number,
            departure_airport,
            destination_airport,
            departure_time,
            arrival_time,
            aircraft_id,
            price
        } = req.body;

        // Start a transaction
        await client.query('BEGIN');

        // Use an advisory lock
        const lockKey = aircraft_id;
        await client.query('SELECT pg_advisory_lock($1)', [lockKey]);

        // Check if flight with the same number exists within the same time period
        const existingFlight = await client.query(
            `SELECT * FROM flights 
             WHERE flight_number = $1 
             AND (departure_time, arrival_time) OVERLAPS ($2, $3)`,
            [flight_number, departure_time, arrival_time]
        );

        if (existingFlight.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Flight with this number already exists in the same time period' });
        }

        const flightResult = await client.query(
            'INSERT INTO flights (flight_number, departure_airport, destination_airport, departure_time, arrival_time, aircraft_id, price) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [flight_number, departure_airport, destination_airport, departure_time, arrival_time, aircraft_id, price]
        );

        const flightId = flightResult.rows[0].flight_id;

        const aircraftResult = await client.query('SELECT total_seats FROM aircraft WHERE aircraft_id = $1', [aircraft_id]);
        const totalSeats = aircraftResult.rows[0].total_seats;

        // Batch insert for seats
        const seatValues = [];
        for (let i = 1; i <= totalSeats; i++) {
            const seatNumber = `A${i}`;
            seatValues.push(`(${flightId}, '${seatNumber}', true)`);
        }
        const seatQuery = `INSERT INTO seats (flight_id, seat_number, seat_status) VALUES ${seatValues.join(', ')} RETURNING *`;
        
        await client.query(seatQuery);

        await client.query('COMMIT');
        await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
        res.json(flightResult.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// Get flight by id
router.get('/:id', [auth], async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.number().integer().min(1).required()
        });

        const { error } = schema.validate(req.params);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }
        const { id } = req.params;

        const flight = await pool.query(
            'SELECT * FROM flights WHERE flight_id = $1 AND is_deleted = FALSE',
            [id]
        );

        if (flight.rows.length === 0) {
            return res.status(404).json({ error: 'Flight not found' });
        }

        res.json(flight.rows[0]);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Get flights by date
router.get('/by-date/:date', auth, async (req, res) => {
    const schema = Joi.object({
        date: Joi.date().required()
    });

    const { error, value } = schema.validate(req.params);

    if (error) {
        console.log(req.params)
        return res.status(400).json({ error: error.details[0].message });
    }

    const { date } = value;
    const parsedDate = new Date(date);
    try {
        const result = await pool.query(
            'SELECT * FROM flights WHERE DATE(departure_time) = $1 AND is_deleted = FALSE',
            [parsedDate]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});


// Update Flight
router.put('/:id', [auth, admin], async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.number().integer().min(1).required()
        });

        const { error } = schema.validate(req.params);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { id } = req.params;
        const {
            flight_number,
            departure_airport,
            destination_airport,
            departure_time,
            arrival_time,
            aircraft_id,
            price
        } = req.body;

        const updatedFlight = await pool.query(
            'UPDATE flights SET flight_number = $1, departure_airport = $2, destination_airport = $3, departure_time = $4, arrival_time = $5, aircraft_id = $6, price = $7 WHERE flight_id = $8 AND is_deleted = FALSE RETURNING *',
            [flight_number, departure_airport, destination_airport, departure_time, arrival_time, aircraft_id, price, id]
        );

        if (updatedFlight.rows.length === 0) {
            return res.status(404).json({ error: 'Flight not found or already deleted' });
        }

        res.json(updatedFlight.rows[0]);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Delete Flight
router.delete('/:id', [auth, admin], async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.number().integer().min(1).required()
        });

        const { error } = schema.validate(req.params);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }
        const { id } = req.params;

        const updatedFlight = await pool.query(
            'UPDATE flights SET is_deleted = TRUE WHERE flight_id = $1 RETURNING *',
            [id]
        );

        if (updatedFlight.rows.length === 0) {
            return res.status(404).json({ error: 'Flight not found' });
        }

        res.json({ message: 'Flight deleted successfully' });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Undelete Flight
router.put('/undelete/:id', [auth, admin], async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.number().integer().min(1).required()
        });

        const { error } = schema.validate(req.params);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { id } = req.params;

        const updatedFlight = await pool.query(
            'UPDATE flights SET is_deleted = FALSE WHERE flight_id = $1 RETURNING *',
            [id]
        );

        if (updatedFlight.rows.length === 0) {
            return res.status(404).json({ error: 'Flight not found' });
        }

        res.json({ message: 'Flight undeleted successfully' });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;
