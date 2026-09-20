/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable("timers", (table) => {
    table.increments("id")
    table.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.bigInteger("start").notNullable();
    table.bigInteger("end").nullable();
    table.bigInteger("duration").nullable();
    table.text("description").notNullable();
    table.boolean("is_active").notNullable().defaultTo(true);
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable("timers");
};
