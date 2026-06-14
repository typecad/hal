import { SensorProcessor, SensorStatus, calculateMovingAverage, formatReading, clampValue } from "./services/SensorProcessor";
import { DEFAULT_THRESHOLD } from "./models/SensorTypes";

function runSensorMonitor() {
  const processor = new SensorProcessor(DEFAULT_THRESHOLD);

  console.log("Sensor Monitor Started");
  console.log("Monitoring: Temperature");
  console.log("Default threshold: " + DEFAULT_THRESHOLD);

  const rawValues: number[] = [22, 25, 30, 45, 85, 100, -1, 28];

  for (const value of rawValues) {
    processor.addReading(value);
  }

  const readings = processor.getReadings();
  console.log("Total readings: " + readings.length);

  const avg = processor.getAverage();
  console.log("Average value: " + avg);

  const movingAvg = calculateMovingAverage(rawValues, 3);
  console.log("Moving average count: " + movingAvg.length);

  let warnings = 0;
  for (const r of readings) {
    if (r.status == SensorStatus.Warning) {
      warnings++;
    }
  }
  console.log("Warnings count: " + warnings);

  const errorCount = processor.countErrors();
  console.log("Error count: " + errorCount);

  const lastIndex = processor.getLastIndex();
  if (lastIndex >= 0) {
    console.log("Last reading: " + formatReading(readings[lastIndex]));
  }

  const history = processor.getHistory();
  console.log("History values: " + history.length);

  const highReadings = processor.filterAbove(50);
  console.log("Above 50: " + highReadings.length);

  const normalized = clampValue(150, 0, 100);
  console.log("Normalized value: " + normalized);

  processor.clear();

  console.log("Sensor Monitor Finished");
}

runSensorMonitor();