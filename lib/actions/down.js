const _ = require("lodash");
const { promisify } = require("util");
const fnArgs = require("fn-args");
const pEachSeries = require("p-each-series");

const status = require("./status");
const config = require("../env/config");
const migrationsDir = require("../env/migrationsDir");
const hasCallback = require("../utils/has-callback");

module.exports = async (db, client, options) => {
  const downgraded = [];
  const statusItems = await status(db);
  const appliedItems = statusItems.filter(
    (item) => item.appliedAt !== "PENDING"
  );
  const lastAppliedItem = _.last(appliedItems);

  const downgrateItem = async (item) => {
    try {
      const migration = await migrationsDir.loadMigration(item.fileName);
      const down = hasCallback(migration.down)
        ? promisify(migration.down)
        : migration.down;

      if (hasCallback(migration.down) && fnArgs(migration.down).length < 3) {
        // support old callback-based migrations prior to migrate-mongo 7.x.x
        await down(db);
      } else {
        await down(db, client);
      }
    } catch (err) {
      throw new Error(
        `Could not migrate down ${item.fileName}: ${err.message}`
      );
    }
    const { changelogCollectionName } = await config.read();
    const changelogCollection = db.collection(changelogCollectionName);
    try {
      await changelogCollection.deleteOne({ fileName: item.fileName });
      downgraded.push(item.fileName);
    } catch (err) {
      throw new Error(`Could not update changelog: ${err.message}`);
    }
  };

  if (options.script) {
    const script = appliedItems.find((r) => r.fileName === options.script);
    if (!script) {
      throw new Error(`Migration script ${options.script} not found.`);
    }
    await downgrateItem(script);
  } else if (options.all) {
    await pEachSeries(appliedItems, downgrateItem);
  } else if (lastAppliedItem) {
    await pEachSeries(appliedItems, downgrateItem);
  }

  return downgraded;
};
