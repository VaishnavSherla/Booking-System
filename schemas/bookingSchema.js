const Joi = require('joi');

const bookingSchema = Joi.object({
    flight_id: Joi.number().integer().required(),
    seat_id: Joi.number().integer().required(),
});

module.exports = bookingSchema;
