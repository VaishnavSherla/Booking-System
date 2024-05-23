const Joi = require('joi');

const seatSchema = Joi.object({
    flight_id: Joi.number().integer().required(),
    seat_number: Joi.string().required(),
});

module.exports = seatSchema;
