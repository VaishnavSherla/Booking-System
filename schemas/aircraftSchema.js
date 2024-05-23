const Joi = require('joi');

const aircraftSchema = Joi.object({
    name: Joi.string().required(),
    total_seats: Joi.number().integer()
});

module.exports = aircraftSchema;
