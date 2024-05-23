const express = require('express');
const router = express.Router();
const pool = require('../db');
const aircraftSchema = require('../schemas/aircraftSchema');
const Joi = require('joi');
const auth = require('../middlewares/auth')
const admin = require('../middlewares/admin')

// Create Aircraft
router.post('/', [auth, admin], async (req, res) => {
    try {
        const { error } = aircraftSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { name, total_seats } = req.body;
        
        const newAircraft = await pool.query(
            'INSERT INTO aircraft (name, total_seats) VALUES ($1, $2) RETURNING *',
            [name, total_seats]
        );

        res.json(newAircraft.rows[0]);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Read Aircraft
router.get('/:id', [auth, admin], async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.number().integer().min(1).required()
        });
        
        const { error } = schema.validate(req.params);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { id } = req.params;

        const aircraft = await pool.query(
            'SELECT * FROM aircraft WHERE aircraft_id = $1 AND is_deleted = FALSE',
            [id]
        );

        if (aircraft.rows.length === 0) {
            return res.status(404).json({ error: 'Aircraft not found' });
        }

        res.json(aircraft.rows[0]);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Update Aircraft
router.put('/:id',[auth, admin], async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.number().integer().min(1).required()
        });

        const { error } = schema.validate(req.params);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { id } = req.params;
        const { name, total_seats } = req.body;

        const updatedAircraft = await pool.query(
            'UPDATE aircraft SET name = $1, total_seats = $2 WHERE aircraft_id = $3 AND is_deleted = FALSE RETURNING *',
            [name, total_seats, id]
        );

        if (updatedAircraft.rows.length === 0) {
            return res.status(404).json({ error: 'Aircraft not found or already deleted' });
        }

        res.json(updatedAircraft.rows[0]);
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Delete Aircraft
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

        const deletedAircraft = await pool.query(
            'UPDATE aircraft SET is_deleted = TRUE WHERE aircraft_id = $1 RETURNING *',
            [id]
        );

        if (deletedAircraft.rows.length === 0) {
            return res.status(404).json({ error: 'Aircraft not found' });
        }

        res.json({ message: 'Aircraft deleted successfully' });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});

// Undelete Aircraft
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

        const undeletedAircraft = await pool.query(
            'UPDATE aircraft SET is_deleted = FALSE WHERE aircraft_id = $1 RETURNING *',
            [id]
        );

        if (undeletedAircraft.rows.length === 0) {
            return res.status(404).json({ error: 'Aircraft not found' });
        }

        res.json({ message: 'Aircraft undeleted successfully' });
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;
