const Joi = require('joi');

const flightSchema = Joi.object({
    flight_number: Joi.string().required(),
    departure_airport: Joi.string().required(),
    destination_airport: Joi.string().required(),
    departure_time: Joi.date().iso().greater('now').required().messages({
        'date.greater': 'departure_time must be in the future'
    }),
    arrival_time: Joi.date().iso().required(),
    aircraft_id: Joi.number().integer().required(),
    price: Joi.number().precision(2).required()
});

module.exports = flightSchema;
