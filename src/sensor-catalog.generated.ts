// ---------------------------------------------------------------------------
// sensor-catalog.generated.ts — the Zephyr sensor part catalog
//
// GENERATED FILE — do not edit by hand. Regenerate against a workspace at the
// pinned revision (v4.4.2) with:
//
//   node scripts/gen-zephyr-sensor-parts.mjs <workspace>
//
// Derived from Zephyr 4.4: dts/bindings/sensor/*.yaml (compatible, bus
// kind, description) joined against the in-tree drivers' SENSOR_CHAN_*
// occurrences (255 drivers scanned). 215 parts.
// Compatibles whose underscored form collides are dropped (0).
//
// This is the entire per-part surface of the Sensor HAL — `SENSOR.`
// enumerates it for completion, and framework-zephyr resolves DT facts from
// SENSOR_PART_INFO at lowering time. No per-part code exists anywhere.
// ---------------------------------------------------------------------------

/** Facts about one sensor part, keyed by its underscored compatible. */
export interface SensorPartInfo {
  /** The devicetree compatible string ('sensirion,sht3xd'). */
  compatible: string;
  /** Buses the part binds on ('i2c', 'spi', or both). */
  buses: readonly string[];
  /** First line of the binding's description (hover text). */
  description: string;
  /** SENSOR_CHAN_* suffixes the driver serves (empty = unscanned driver). */
  channels: readonly string[];
  /** The binding declares an optional alert-gpios (constructor opt alert?: Pin). */
  alert: boolean;
  /** Kconfig lines the part needs beyond CONFIG_SENSOR (empty — every in-tree
   *  sensor driver is default-y on its DT node; the field exists so an
   *  exception found by a future scan has a path to prj.conf). */
  kconfig: readonly string[];
}

/** Part facts keyed by the underscored compatible (the SENSOR token value). */
export const SENSOR_PART_INFO: Readonly<Record<string, SensorPartInfo>> = {
  "adi_ad2s1210": { compatible: "adi,ad2s1210", buses: ['spi'], description: "|", channels: ['ROTATION', 'RPM'], alert: false, kconfig: [] },
  "adi_ade7978": { compatible: "adi,ade7978", buses: ['spi'], description: "ADE7978 Isolated energy metering chipset for polyphase shunt meters", channels: ['CURRENT', 'VOLTAGE'], alert: false, kconfig: [] },
  "adi_adltc2990": { compatible: "adi,adltc2990", buses: ['i2c'], description: "ADLTC2990 Quad I2C Voltage, Current and Temperature Monitor", channels: ['AMBIENT_TEMP', 'CURRENT', 'DIE_TEMP', 'VOLTAGE'], alert: false, kconfig: [] },
  "adi_adt7310": { compatible: "adi,adt7310", buses: ['spi'], description: "ADT7310 16-Bit digital SPI temperature sensor", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "adi_adt7410": { compatible: "adi,adt7410", buses: ['i2c'], description: "ADT7410 16-Bit digital I2C temperature sensor", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "adi_adt7420": { compatible: "adi,adt7420", buses: ['i2c'], description: "ADT7420 16-Bit digital I2C temperature sensor", channels: [], alert: false, kconfig: [] },
  "adi_adt7422": { compatible: "adi,adt7422", buses: ['i2c'], description: "ADT7422 16-Bit digital I2C temperature sensor", channels: [], alert: false, kconfig: [] },
  "adi_adxl345": { compatible: "adi,adxl345", buses: ['i2c', 'spi'], description: "ADXL345 3-axis I2C accelerometer", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z'], alert: false, kconfig: [] },
  "adi_adxl355": { compatible: "adi,adxl355", buses: ['i2c', 'spi'], description: "ADXL355 3-axis accelerometer with I2C connection", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'AMBIENT_TEMP', 'DIE_TEMP'], alert: false, kconfig: [] },
  "adi_adxl362": { compatible: "adi,adxl362", buses: ['spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "adi_adxl366": { compatible: "adi,adxl366", buses: ['i2c', 'spi'], description: "ADXL366 3-axis nanopower accelerometer, accessed through I2C bus", channels: [], alert: false, kconfig: [] },
  "adi_adxl367": { compatible: "adi,adxl367", buses: ['i2c', 'spi'], description: "ADXL367 3-axis nanopower accelerometer, accessed through I2C bus", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "adi_adxl372": { compatible: "adi,adxl372", buses: ['i2c', 'spi'], description: "ADXL372 3-axis high-g accelerometer, accessed through I2C bus", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z'], alert: false, kconfig: [] },
  "adi_max30210": { compatible: "adi,max30210", buses: ['i2c'], description: "MAX30210, a high-accuracy digital temperature sensor from Analog Devices.", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "allegro_als31300": { compatible: "allegro,als31300", buses: ['i2c'], description: "Allegro ALS31300 3D Linear Hall Effect Sensor", channels: ['AMBIENT_TEMP', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "amd_sb_tsi": { compatible: "amd,sb-tsi", buses: ['i2c'], description: "AMD SB Temperature Sensor Interface.", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "ams_as5048": { compatible: "ams,as5048", buses: ['spi'], description: "|", channels: ['ROTATION'], alert: false, kconfig: [] },
  "ams_as5600": { compatible: "ams,as5600", buses: ['i2c'], description: "|", channels: ['ROTATION'], alert: false, kconfig: [] },
  "ams_as6212": { compatible: "ams,as6212", buses: ['i2c'], description: "|", channels: [], alert: true, kconfig: [] },
  "ams_as6221": { compatible: "ams,as6221", buses: ['i2c'], description: "|", channels: [], alert: true, kconfig: [] },
  "ams_ccs811": { compatible: "ams,ccs811", buses: ['i2c'], description: "CCS811 digital air quality sensor", channels: ['CO2', 'CURRENT', 'VOC', 'VOLTAGE'], alert: false, kconfig: [] },
  "ams_ens210": { compatible: "ams,ens210", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "ams_iaqcore": { compatible: "ams,iaqcore", buses: ['i2c'], description: "iAQ-core indoor air quality sensor", channels: ['CO2', 'RESISTANCE', 'VOC'], alert: false, kconfig: [] },
  "ams_tcs3400": { compatible: "ams,tcs3400", buses: ['i2c'], description: "AMS TCS3400 Color Light-to-Digital Converter", channels: ['BLUE', 'GREEN', 'LIGHT', 'RED'], alert: false, kconfig: [] },
  "ams_tmd2620": { compatible: "ams,tmd2620", buses: ['i2c'], description: "OSRAM ams TMD2620 Proximity Sensor", channels: ['PROX'], alert: false, kconfig: [] },
  "ams_tsl2540": { compatible: "ams,tsl2540", buses: ['i2c'], description: "|", channels: ['IR', 'LIGHT'], alert: false, kconfig: [] },
  "ams_tsl2561": { compatible: "ams,tsl2561", buses: ['i2c'], description: "|", channels: ['LIGHT'], alert: false, kconfig: [] },
  "ams_tsl2591": { compatible: "ams,tsl2591", buses: ['i2c'], description: "|", channels: ['IR', 'LIGHT'], alert: false, kconfig: [] },
  "aosong_ags10": { compatible: "aosong,ags10", buses: ['i2c'], description: "|", channels: ['VOC'], alert: false, kconfig: [] },
  "aosong_aht20": { compatible: "aosong,aht20", buses: ['i2c'], description: "|", channels: [], alert: false, kconfig: [] },
  "aosong_am2301b": { compatible: "aosong,am2301b", buses: ['i2c'], description: "|", channels: [], alert: false, kconfig: [] },
  "aosong_dht20": { compatible: "aosong,dht20", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "asahi_kasei_ak8975": { compatible: "asahi-kasei,ak8975", buses: ['i2c'], description: "|", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "asahi_kasei_akm09918c": { compatible: "asahi-kasei,akm09918c", buses: ['i2c'], description: "|", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "avago_apds9253": { compatible: "avago,apds9253", buses: ['i2c'], description: "APDS9253 ambient light, RGB", channels: ['BLUE', 'GREEN', 'IR', 'RED'], alert: false, kconfig: [] },
  "avago_apds9306": { compatible: "avago,apds9306", buses: ['i2c'], description: "APDS9306 miniature Surface-Mount Digital Ambient Light Sensor.", channels: ['LIGHT'], alert: false, kconfig: [] },
  "avago_apds9960": { compatible: "avago,apds9960", buses: ['i2c'], description: "APDS9960 digital proximity, ambient light, RGB, and gesture sensor", channels: ['BLUE', 'GREEN', 'LIGHT', 'PROX', 'RED'], alert: false, kconfig: [] },
  "avia_hx711_spi": { compatible: "avia,hx711-spi", buses: ['spi'], description: "|", channels: ['VOLTAGE'], alert: false, kconfig: [] },
  "bosch_bma280": { compatible: "bosch,bma280", buses: ['i2c'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "bosch_bma4xx": { compatible: "bosch,bma4xx", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "bosch_bmc150_magn": { compatible: "bosch,bmc150_magn", buses: ['i2c'], description: "|", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "bosch_bme280": { compatible: "bosch,bme280", buses: ['i2c', 'spi'], description: "BME280 integrated environmental sensor", channels: ['AMBIENT_TEMP', 'HUMIDITY', 'PRESS'], alert: false, kconfig: [] },
  "bosch_bme680": { compatible: "bosch,bme680", buses: ['i2c', 'spi'], description: "|", channels: ['AMBIENT_TEMP', 'GAS_RES', 'HUMIDITY', 'PRESS'], alert: false, kconfig: [] },
  "bosch_bmg160": { compatible: "bosch,bmg160", buses: ['i2c'], description: "|", channels: ['DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "bosch_bmi08x_accel": { compatible: "bosch,bmi08x-accel", buses: ['i2c', 'spi'], description: "BMI08X Accel inertial measurement unit", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "bosch_bmi08x_gyro": { compatible: "bosch,bmi08x-gyro", buses: ['i2c', 'spi'], description: "BMI08X Gyro inertial measurement unit", channels: ['GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "bosch_bmi160": { compatible: "bosch,bmi160", buses: ['i2c', 'spi'], description: "BMI160 inertial measurement unit", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "bosch_bmi270": { compatible: "bosch,bmi270", buses: ['i2c', 'spi'], description: "", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "bosch_bmi323": { compatible: "bosch,bmi323", buses: ['spi'], description: "", channels: ['ACCEL_XYZ', 'DIE_TEMP', 'GYRO_XYZ'], alert: false, kconfig: [] },
  "bosch_bmm150": { compatible: "bosch,bmm150", buses: ['i2c', 'spi'], description: "|", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "bosch_bmm350": { compatible: "bosch,bmm350", buses: ['i2c'], description: "|", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "bosch_bmp180": { compatible: "bosch,bmp180", buses: ['i2c'], description: "|", channels: ['DIE_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "bosch_bmp388": { compatible: "bosch,bmp388", buses: ['i2c', 'spi'], description: "|", channels: ['AMBIENT_TEMP', 'DIE_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "bosch_bmp390": { compatible: "bosch,bmp390", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "bosch_bmp581": { compatible: "bosch,bmp581", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "brcm_afbr_s50": { compatible: "brcm,afbr-s50", buses: ['spi'], description: "|", channels: ['DISTANCE'], alert: false, kconfig: [] },
  "fintek_f75303": { compatible: "fintek,f75303", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "hamamatsu_s11059": { compatible: "hamamatsu,s11059", buses: ['i2c'], description: "|", channels: ['BLUE', 'GREEN', 'RED'], alert: false, kconfig: [] },
  "honeywell_hmc5883l": { compatible: "honeywell,hmc5883l", buses: ['i2c'], description: "Honeywell HMC5883L 3-axis magnetometer sensor", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "honeywell_mpr": { compatible: "honeywell,mpr", buses: ['i2c'], description: "|", channels: ['PRESS'], alert: false, kconfig: [] },
  "hoperf_hp206c": { compatible: "hoperf,hp206c", buses: ['i2c'], description: "|", channels: ['ALTITUDE', 'AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "hoperf_th02": { compatible: "hoperf,th02", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "infineon_dps310": { compatible: "infineon,dps310", buses: ['i2c'], description: "Infineon DPS310 temperature and pressure sensor", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "invensense_icm40627": { compatible: "invensense,icm40627", buses: ['i2c'], description: "ICM-40627 motion tracking device", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "invensense_icm42370p": { compatible: "invensense,icm42370p", buses: ['i2c', 'spi'], description: "ICM-42370-P motion tracking device", channels: [], alert: false, kconfig: [] },
  "invensense_icm42605": { compatible: "invensense,icm42605", buses: ['spi'], description: "ICM-42605 motion tracking device", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "invensense_icm42670p": { compatible: "invensense,icm42670p", buses: ['i2c', 'spi'], description: "ICM-42670-P motion tracking device", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "invensense_icm42670s": { compatible: "invensense,icm42670s", buses: ['i2c', 'spi'], description: "ICM-42670-S motion tracking device", channels: [], alert: false, kconfig: [] },
  "invensense_icm4268x": { compatible: "invensense,icm4268x", buses: ['spi'], description: "", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "invensense_icm45605": { compatible: "invensense,icm45605", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "invensense_icm45605s": { compatible: "invensense,icm45605s", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "invensense_icm45686": { compatible: "invensense,icm45686", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "invensense_icm45686s": { compatible: "invensense,icm45686s", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "invensense_icm45688p": { compatible: "invensense,icm45688p", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "invensense_icp101xx": { compatible: "invensense,icp101xx", buses: ['i2c'], description: "ICP101xx High Accuracy, Low Power, Barometric Pressure and Temperature Sensors IC", channels: ['ALTITUDE', 'AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "invensense_icp201xx": { compatible: "invensense,icp201xx", buses: ['i2c', 'spi'], description: "ICP201xx High Accuracy, Low Power, Barometric Pressure and Temperature Sensor IC", channels: ['ALTITUDE', 'AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "invensense_mpu6050": { compatible: "invensense,mpu6050", buses: ['i2c'], description: "MPU-6000 motion tracking device", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "invensense_mpu9250": { compatible: "invensense,mpu9250", buses: ['i2c'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "isentek_ist8310": { compatible: "isentek,ist8310", buses: ['i2c'], description: "|", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "isil_isl29035": { compatible: "isil,isl29035", buses: ['i2c'], description: "|", channels: ['IR', 'LIGHT'], alert: false, kconfig: [] },
  "jedec_jc_42.4_temp": { compatible: "jedec,jc-42.4-temp", buses: ['i2c'], description: "|", channels: [], alert: false, kconfig: [] },
  "liteon_ltr329": { compatible: "liteon,ltr329", buses: ['i2c'], description: "LiteOn LTR-329 Digital Ambient Light Sensor", channels: [], alert: false, kconfig: [] },
  "liteon_ltr553": { compatible: "liteon,ltr553", buses: ['i2c'], description: "LiteOn LTR-553 Digital Ambient Light and proximity sensor", channels: [], alert: false, kconfig: [] },
  "liteon_ltrf216a": { compatible: "liteon,ltrf216a", buses: ['i2c'], description: "LiteOn F216A ambient light sensor", channels: ['LIGHT'], alert: false, kconfig: [] },
  "lm75": { compatible: "lm75", buses: ['i2c'], description: "LM75 Digital Temperature Sensor with 2-Wire Interface.", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "lm77": { compatible: "lm77", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "maxbotix_mb7040": { compatible: "maxbotix,mb7040", buses: ['i2c'], description: "MB7040 ultrasonic distance sensor", channels: ['DISTANCE'], alert: false, kconfig: [] },
  "maxim_max17055": { compatible: "maxim,max17055", buses: ['i2c'], description: "Maxim MAX17055 Fuel Gauge", channels: ['CURRENT', 'GAUGE_AVG_CURRENT', 'GAUGE_CYCLE_COUNT', 'GAUGE_DESIGN_VOLTAGE', 'GAUGE_DESIRED_CHARGING_CURRENT', 'GAUGE_DESIRED_VOLTAGE', 'GAUGE_FULL_CHARGE_CAPACITY', 'GAUGE_NOM_AVAIL_CAPACITY', 'GAUGE_REMAINING_CHARGE_CAPACITY', 'GAUGE_STATE_OF_CHARGE', 'GAUGE_TEMP', 'GAUGE_TIME_TO_EMPTY', 'GAUGE_TIME_TO_FULL', 'GAUGE_VOLTAGE'], alert: false, kconfig: [] },
  "maxim_max17262": { compatible: "maxim,max17262", buses: ['i2c'], description: "Maxim MAX17262 Fuel Gauge", channels: ['GAUGE_AVG_CURRENT', 'GAUGE_CYCLE_COUNT', 'GAUGE_DESIGN_VOLTAGE', 'GAUGE_DESIRED_CHARGING_CURRENT', 'GAUGE_DESIRED_VOLTAGE', 'GAUGE_FULL_CHARGE_CAPACITY', 'GAUGE_NOM_AVAIL_CAPACITY', 'GAUGE_REMAINING_CHARGE_CAPACITY', 'GAUGE_STATE_OF_CHARGE', 'GAUGE_TEMP', 'GAUGE_TIME_TO_EMPTY', 'GAUGE_TIME_TO_FULL', 'GAUGE_VOLTAGE'], alert: false, kconfig: [] },
  "maxim_max30101": { compatible: "maxim,max30101", buses: ['i2c'], description: "MAX30101 heart rate sensor", channels: ['AMBIENT_LIGHT', 'DIE_TEMP', 'GREEN', 'IR', 'LIGHT', 'RED'], alert: false, kconfig: [] },
  "maxim_max31855": { compatible: "maxim,max31855", buses: ['spi'], description: "MAX31855 SPI-based cold-junction compensated thermocouple-to-digital converter.", channels: ['AMBIENT_TEMP', 'DIE_TEMP'], alert: false, kconfig: [] },
  "maxim_max31865": { compatible: "maxim,max31865", buses: ['spi'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "maxim_max31875": { compatible: "maxim,max31875", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "maxim_max32664c": { compatible: "maxim,max32664c", buses: ['i2c'], description: "|", channels: ['ACCEL_X', 'ACCEL_Y', 'ACCEL_Z', 'GREEN', 'IR', 'RED'], alert: false, kconfig: [] },
  "maxim_max44009": { compatible: "maxim,max44009", buses: ['i2c'], description: "|", channels: ['LIGHT'], alert: false, kconfig: [] },
  "maxim_max6675": { compatible: "maxim,max6675", buses: ['spi'], description: "MAX6675 K-thermocouple to digital converter", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "meas_ms5607": { compatible: "meas,ms5607", buses: ['i2c', 'spi'], description: "|", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "meas_ms5837_02ba": { compatible: "meas,ms5837-02ba", buses: ['i2c'], description: "TE Connectivity MS5837-02BA digital pressure sensor", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "meas_ms5837_30ba": { compatible: "meas,ms5837-30ba", buses: ['i2c'], description: "TE Connectivity MS5837-30BA digital pressure sensor", channels: [], alert: false, kconfig: [] },
  "melexis_mlx90394": { compatible: "melexis,mlx90394", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "memsic_mc3419": { compatible: "memsic,mc3419", buses: ['i2c'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z'], alert: false, kconfig: [] },
  "memsic_mmc56x3": { compatible: "memsic,mmc56x3", buses: ['i2c'], description: "MMC56X3 3-axis magnetic and temperature sensor", channels: ['AMBIENT_TEMP', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "microchip_mcp9600": { compatible: "microchip,mcp9600", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "microchip_tcn75a": { compatible: "microchip,tcn75a", buses: ['i2c'], description: "TCN75A ambient temperature sensor", channels: ['AMBIENT_TEMP'], alert: true, kconfig: [] },
  "national_lm95234": { compatible: "national,lm95234", buses: ['i2c'], description: "LM95234 Quad Remote Diode and Local Temperature Sensor with SMBus Interface", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "nxp_fxas21002": { compatible: "nxp,fxas21002", buses: ['i2c', 'spi'], description: "FXAS21002 3-axis gyroscope sensor", channels: ['GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "nxp_fxls8974": { compatible: "nxp,fxls8974", buses: ['i2c', 'spi'], description: "FXLS8974 3-axis accelerometer sensor", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'AMBIENT_TEMP'], alert: false, kconfig: [] },
  "nxp_fxos8700": { compatible: "nxp,fxos8700", buses: ['i2c', 'spi'], description: "FXOS8700 6-axis accelerometer/magnetometer sensor", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "nxp_p3t1755": { compatible: "nxp,p3t1755", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "omron_2smpb_02e": { compatible: "omron,2smpb-02e", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "onnn_nct75": { compatible: "onnn,nct75", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "panasonic_amg88xx": { compatible: "panasonic,amg88xx", buses: ['i2c'], description: "Panasonic AMG88XX 8x8 (64) pixel infrared array sensor", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "phosense_xbr818": { compatible: "phosense,xbr818", buses: ['i2c'], description: "|", channels: ['PROX'], alert: false, kconfig: [] },
  "pixart_paa3905": { compatible: "pixart,paa3905", buses: ['spi'], description: "PA3905 optical flow sensor", channels: ['POS_DX', 'POS_DXYZ', 'POS_DY'], alert: false, kconfig: [] },
  "pixart_paj7620": { compatible: "pixart,paj7620", buses: ['i2c'], description: "Pixart PAJ7620 gesture sensor", channels: [], alert: false, kconfig: [] },
  "pixart_pat9136": { compatible: "pixart,pat9136", buses: ['spi'], description: "PAT9136 optical flow sensor", channels: ['POS_DX', 'POS_DXYZ', 'POS_DY'], alert: false, kconfig: [] },
  "pni_rm3100": { compatible: "pni,rm3100", buses: ['i2c', 'spi'], description: "|", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "qst_qmi8658a": { compatible: "qst,qmi8658a", buses: ['i2c'], description: "QST QMI8658A 6-axis IMU", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "renesas_hs300x": { compatible: "renesas,hs300x", buses: ['i2c'], description: "Renesas HS300x humidity and temperature sensor", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "renesas_hs400x": { compatible: "renesas,hs400x", buses: ['i2c'], description: "Renesas HS400x humidity and temperature sensor", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "rohm_bh1730": { compatible: "rohm,bh1730", buses: ['i2c'], description: "Rohm BH1730 ambient light sensor.", channels: ['LIGHT'], alert: false, kconfig: [] },
  "rohm_bh1750": { compatible: "rohm,bh1750", buses: ['i2c'], description: "Rohm BH1750 ambient light sensor.", channels: ['LIGHT'], alert: false, kconfig: [] },
  "rohm_bh1790": { compatible: "rohm,bh1790", buses: ['i2c'], description: "Rohm BH1790 Optical Sensor for Heart Rate Monitor IC.", channels: ['GREEN', 'LIGHT'], alert: false, kconfig: [] },
  "sbs_sbs_gauge": { compatible: "sbs,sbs-gauge", buses: ['i2c'], description: "SBS 1.1 compliant fuel gauge (http://www.sbs-forum.org/specs)", channels: ['GAUGE_AVG_CURRENT', 'GAUGE_CYCLE_COUNT', 'GAUGE_FULL_AVAIL_CAPACITY', 'GAUGE_FULL_CHARGE_CAPACITY', 'GAUGE_NOM_AVAIL_CAPACITY', 'GAUGE_REMAINING_CHARGE_CAPACITY', 'GAUGE_STATE_OF_CHARGE', 'GAUGE_TEMP', 'GAUGE_TIME_TO_EMPTY', 'GAUGE_TIME_TO_FULL', 'GAUGE_VOLTAGE'], alert: false, kconfig: [] },
  "sciosense_ens160": { compatible: "sciosense,ens160", buses: ['i2c', 'spi'], description: "|", channels: ['CO2', 'VOC'], alert: false, kconfig: [] },
  "seeed_hm330x": { compatible: "seeed,hm330x", buses: ['i2c'], description: "|", channels: ['PM_10', 'PM_1_0', 'PM_2_5'], alert: false, kconfig: [] },
  "semtech_sx9500": { compatible: "semtech,sx9500", buses: ['i2c'], description: "|", channels: ['PROX'], alert: false, kconfig: [] },
  "sensirion_scd40": { compatible: "sensirion,scd40", buses: ['i2c'], description: "Sensirion SCD4x temperature sensor", channels: ['AMBIENT_TEMP', 'CO2', 'HUMIDITY'], alert: false, kconfig: [] },
  "sensirion_scd41": { compatible: "sensirion,scd41", buses: ['i2c'], description: "Sensirion SCD4x temperature sensor", channels: [], alert: false, kconfig: [] },
  "sensirion_sgp40": { compatible: "sensirion,sgp40", buses: ['i2c'], description: "Sensirion SGP40 Multipixel Gas Sensor", channels: ['GAS_RES'], alert: false, kconfig: [] },
  "sensirion_sht21": { compatible: "sensirion,sht21", buses: ['i2c'], description: "|", channels: [], alert: false, kconfig: [] },
  "sensirion_sht3xd": { compatible: "sensirion,sht3xd", buses: ['i2c'], description: "Sensirion Humidity SHT3x-DIS humidity and temperature sensor", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: true, kconfig: [] },
  "sensirion_sht4x": { compatible: "sensirion,sht4x", buses: ['i2c'], description: "Sensirion SHT4x humidity and temperature sensor", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "sensirion_shtcx": { compatible: "sensirion,shtcx", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "sensirion_stcc4": { compatible: "sensirion,stcc4", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP', 'CO2', 'HUMIDITY'], alert: false, kconfig: [] },
  "sensirion_sts4x": { compatible: "sensirion,sts4x", buses: ['i2c'], description: "Sensirion STS4x temperature sensor", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "silabs_si7055": { compatible: "silabs,si7055", buses: ['i2c'], description: "Si7055 temperature sensor", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "silabs_si7060": { compatible: "silabs,si7060", buses: ['i2c'], description: "Si7060 temperature sensor", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "silabs_si7210": { compatible: "silabs,si7210", buses: ['i2c'], description: "Si7210 hall effect magnetic position and temperature sensor", channels: ['AMBIENT_TEMP', 'MAGN_Z'], alert: false, kconfig: [] },
  "st_hts221": { compatible: "st,hts221", buses: ['i2c', 'spi'], description: "|", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "st_i3g4250d": { compatible: "st,i3g4250d", buses: ['spi'], description: "|", channels: ['GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "st_iis2dh": { compatible: "st,iis2dh", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z'], alert: false, kconfig: [] },
  "st_iis2dlpc": { compatible: "st,iis2dlpc", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z'], alert: false, kconfig: [] },
  "st_iis2iclx": { compatible: "st,iis2iclx", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'AMBIENT_TEMP', 'DIE_TEMP', 'HUMIDITY', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z', 'PRESS'], alert: false, kconfig: [] },
  "st_iis2mdc": { compatible: "st,iis2mdc", buses: ['i2c', 'spi'], description: "|", channels: ['DIE_TEMP', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "st_iis328dq": { compatible: "st,iis328dq", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z'], alert: false, kconfig: [] },
  "st_iis3dhhc": { compatible: "st,iis3dhhc", buses: ['spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z'], alert: false, kconfig: [] },
  "st_iis3dwb": { compatible: "st,iis3dwb", buses: ['spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "st_ilps22qs": { compatible: "st,ilps22qs", buses: ['i2c', 'spi'], description: "|", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "st_ism330dhcx": { compatible: "st,ism330dhcx", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'AMBIENT_TEMP', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z', 'HUMIDITY', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z', 'PRESS'], alert: false, kconfig: [] },
  "st_ism6hg256x": { compatible: "st,ism6hg256x", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "st_lis2de12": { compatible: "st,lis2de12", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "st_lis2dh": { compatible: "st,lis2dh", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "st_lis2dh12": { compatible: "st,lis2dh12", buses: ['i2c'], description: "STMicroelectronics LIS2DH12 3-axis accelerometer", channels: [], alert: false, kconfig: [] },
  "st_lis2ds12": { compatible: "st,lis2ds12", buses: ['i2c', 'spi'], description: "STMicroelectronics LIS2DS12 3-axis accelerometer", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "st_lis2du12": { compatible: "st,lis2du12", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z'], alert: false, kconfig: [] },
  "st_lis2dux12": { compatible: "st,lis2dux12", buses: ['i2c', 'spi'], description: "STMicroelectronics LIS2DUX12 3-axis accelerometer", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "st_lis2duxs12": { compatible: "st,lis2duxs12", buses: ['i2c', 'spi'], description: "STMicroelectronics LIS2DUXS12 3-axis accelerometer", channels: [], alert: false, kconfig: [] },
  "st_lis2dw12": { compatible: "st,lis2dw12", buses: ['i2c', 'spi'], description: "STMicroelectronics LIS2DW12 3-axis accelerometer", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP'], alert: false, kconfig: [] },
  "st_lis2mdl": { compatible: "st,lis2mdl", buses: ['i2c', 'spi'], description: "|", channels: ['DIE_TEMP', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "st_lis3dh": { compatible: "st,lis3dh", buses: ['i2c'], description: "STMicroelectronics LIS3DH 3-axis accelerometer", channels: [], alert: false, kconfig: [] },
  "st_lis3mdl_magn": { compatible: "st,lis3mdl-magn", buses: ['i2c'], description: "STMicroelectronics LIS3MDL magnetometer", channels: ['DIE_TEMP', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "st_lps22df": { compatible: "st,lps22df", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "st_lps22hb_press": { compatible: "st,lps22hb-press", buses: ['i2c'], description: "STMicroelectronics LPS22HB pressure sensor", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "st_lps22hh": { compatible: "st,lps22hh", buses: ['i2c', 'spi'], description: "|", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "st_lps25hb_press": { compatible: "st,lps25hb-press", buses: ['i2c'], description: "STMicroelectronics LPS25HB pressure sensor", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "st_lps28dfw": { compatible: "st,lps28dfw", buses: ['i2c'], description: "|", channels: [], alert: false, kconfig: [] },
  "st_lsm303agr_accel": { compatible: "st,lsm303agr-accel", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "st_lsm303dlhc_accel": { compatible: "st,lsm303dlhc-accel", buses: ['i2c'], description: "LSM303DLHC acceleration sensor", channels: [], alert: false, kconfig: [] },
  "st_lsm303dlhc_magn": { compatible: "st,lsm303dlhc-magn", buses: ['i2c'], description: "STMicroelectronics LSM303DLHC magnetometer sensor", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "st_lsm6ds0": { compatible: "st,lsm6ds0", buses: ['i2c'], description: "STMicroelectronics LSM6DS0 6-axis accelerometer and gyrometer", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "st_lsm6dsl": { compatible: "st,lsm6dsl", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'AMBIENT_TEMP', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z', 'PRESS'], alert: false, kconfig: [] },
  "st_lsm6dso": { compatible: "st,lsm6dso", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'AMBIENT_TEMP', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z', 'HUMIDITY', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z', 'PRESS'], alert: false, kconfig: [] },
  "st_lsm6dso16is": { compatible: "st,lsm6dso16is", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'AMBIENT_TEMP', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z', 'HUMIDITY', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z', 'PRESS'], alert: false, kconfig: [] },
  "st_lsm6dso32": { compatible: "st,lsm6dso32", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "st_lsm6dsv16x": { compatible: "st,lsm6dsv16x", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "st_lsm6dsv320x": { compatible: "st,lsm6dsv320x", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GBIAS_XYZ', 'GYRO_XYZ'], alert: false, kconfig: [] },
  "st_lsm6dsv32x": { compatible: "st,lsm6dsv32x", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "st_lsm6dsv80x": { compatible: "st,lsm6dsv80x", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "st_lsm9ds0_gyro": { compatible: "st,lsm9ds0-gyro", buses: ['i2c'], description: "STMicroelectronics LSM9DS0-GYRO 3-axis gyro", channels: ['GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "st_lsm9ds0_mfd": { compatible: "st,lsm9ds0-mfd", buses: ['i2c'], description: "STMicroelectronics LSM9DS0 3-axis accelerometer + magnetometer", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "st_lsm9ds1": { compatible: "st,lsm9ds1", buses: ['i2c'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'DIE_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "st_lsm9ds1_mag": { compatible: "st,lsm9ds1_mag", buses: ['i2c'], description: "|", channels: ['MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z'], alert: false, kconfig: [] },
  "st_stts22h": { compatible: "st,stts22h", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "st_stts751": { compatible: "st,stts751", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "st_vl53l0x": { compatible: "st,vl53l0x", buses: ['i2c'], description: "STMicroelectronics VL53L0X Time of Flight sensor", channels: ['DISTANCE', 'PROX'], alert: false, kconfig: [] },
  "st_vl53l1x": { compatible: "st,vl53l1x", buses: ['i2c'], description: "STMicroelectronics VL53L1X Time of Flight sensor", channels: ['DISTANCE'], alert: false, kconfig: [] },
  "ti_bq274xx": { compatible: "ti,bq274xx", buses: ['i2c'], description: "Texas Instruments BQ274xx Fuel Gauge", channels: ['GAUGE_AVG_CURRENT', 'GAUGE_AVG_POWER', 'GAUGE_FULL_AVAIL_CAPACITY', 'GAUGE_FULL_CHARGE_CAPACITY', 'GAUGE_MAX_LOAD_CURRENT', 'GAUGE_NOM_AVAIL_CAPACITY', 'GAUGE_REMAINING_CHARGE_CAPACITY', 'GAUGE_STATE_OF_CHARGE', 'GAUGE_STATE_OF_HEALTH', 'GAUGE_STDBY_CURRENT', 'GAUGE_TEMP', 'GAUGE_VOLTAGE'], alert: false, kconfig: [] },
  "ti_fdc2x1x": { compatible: "ti,fdc2x1x", buses: ['i2c'], description: "Texas Instruments FDC2X1X capacitive sensor", channels: [], alert: false, kconfig: [] },
  "ti_hdc": { compatible: "ti,hdc", buses: ['i2c'], description: "Texas Instruments temperature and humidity sensor (e.g. HDC1008)", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "ti_hdc302x": { compatible: "ti,hdc302x", buses: ['i2c'], description: "Texas Instruments HDC302X Temperature and Humidity Sensor", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "ti_ina219": { compatible: "ti,ina219", buses: ['i2c'], description: "Texas Instruments Bidirectional Current/Power Sensor", channels: ['CURRENT', 'POWER', 'VOLTAGE'], alert: false, kconfig: [] },
  "ti_ina3221": { compatible: "ti,ina3221", buses: ['i2c'], description: "Texas Instruments INA3221 Triple-Channel Current/Power Monitor", channels: ['CURRENT', 'POWER', 'VOLTAGE'], alert: false, kconfig: [] },
  "ti_ina7xx": { compatible: "ti,ina7xx", buses: ['i2c'], description: "Texas Instruments Bidirectional Current/Power Sensor", channels: ['CURRENT', 'DIE_TEMP', 'POWER', 'VOLTAGE'], alert: false, kconfig: [] },
  "ti_tmag5170": { compatible: "ti,tmag5170", buses: ['spi'], description: "Texas Instruments TMAG5170 high-precision, linear 3D Hall-effect sensor.", channels: ['AMBIENT_TEMP', 'MAGN_X', 'MAGN_XYZ', 'MAGN_Y', 'MAGN_Z', 'ROTATION'], alert: false, kconfig: [] },
  "ti_tmag5273": { compatible: "ti,tmag5273", buses: ['i2c'], description: "|", channels: [], alert: false, kconfig: [] },
  "ti_tmp007": { compatible: "ti,tmp007", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "ti_tmp1075": { compatible: "ti,tmp1075", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: true, kconfig: [] },
  "ti_tmp108": { compatible: "ti,tmp108", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: true, kconfig: [] },
  "ti_tmp112": { compatible: "ti,tmp112", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "ti_tmp114": { compatible: "ti,tmp114", buses: ['i2c'], description: "Texas Instruments TMP114 temperature sensor", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
  "ti_tmp11x": { compatible: "ti,tmp11x", buses: ['i2c'], description: "Texas Instruments TMP11X temperature sensor", channels: ['AMBIENT_TEMP'], alert: true, kconfig: [] },
  "ti_tmp435": { compatible: "ti,tmp435", buses: ['i2c'], description: "Texas Instruments TMP435 temperature sensor", channels: ['AMBIENT_TEMP', 'DIE_TEMP'], alert: false, kconfig: [] },
  "vishay_vcnl36825t": { compatible: "vishay,vcnl36825t", buses: ['i2c'], description: "|", channels: ['PROX'], alert: false, kconfig: [] },
  "vishay_vcnl4040": { compatible: "vishay,vcnl4040", buses: ['i2c'], description: "|", channels: ['LIGHT', 'PROX'], alert: false, kconfig: [] },
  "vishay_veml6031": { compatible: "vishay,veml6031", buses: ['i2c'], description: "|", channels: ['LIGHT'], alert: false, kconfig: [] },
  "vishay_veml6046": { compatible: "vishay,veml6046", buses: ['i2c'], description: "|", channels: ['BLUE', 'GREEN', 'IR', 'LIGHT', 'RED'], alert: false, kconfig: [] },
  "vishay_veml7700": { compatible: "vishay,veml7700", buses: ['i2c'], description: "|", channels: ['LIGHT'], alert: false, kconfig: [] },
  "we_wsen_hids_2525020210002": { compatible: "we,wsen-hids-2525020210002", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP', 'HUMIDITY'], alert: false, kconfig: [] },
  "we_wsen_isds_2536030320001": { compatible: "we,wsen-isds-2536030320001", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'AMBIENT_TEMP', 'GYRO_X', 'GYRO_XYZ', 'GYRO_Y', 'GYRO_Z'], alert: false, kconfig: [] },
  "we_wsen_itds_2533020201601": { compatible: "we,wsen-itds-2533020201601", buses: ['i2c', 'spi'], description: "|", channels: ['ACCEL_X', 'ACCEL_XYZ', 'ACCEL_Y', 'ACCEL_Z', 'AMBIENT_TEMP'], alert: false, kconfig: [] },
  "we_wsen_pads_2511020213301": { compatible: "we,wsen-pads-2511020213301", buses: ['i2c', 'spi'], description: "|", channels: ['AMBIENT_TEMP', 'PRESS'], alert: false, kconfig: [] },
  "we_wsen_pdms_25131308XXX05": { compatible: "we,wsen-pdms-25131308XXX05", buses: ['i2c', 'spi'], description: "|", channels: [], alert: false, kconfig: [] },
  "we_wsen_pdus_25131308XXXXX": { compatible: "we,wsen-pdus-25131308XXXXX", buses: ['i2c'], description: "|", channels: [], alert: false, kconfig: [] },
  "we_wsen_tids_2521020222501": { compatible: "we,wsen-tids-2521020222501", buses: ['i2c'], description: "|", channels: ['AMBIENT_TEMP'], alert: false, kconfig: [] },
};

/**
 * Sensor part tokens — one per supported sensor part, named vendor and part
 * ('sensirion_sht3xd' for the Sensirion SHT3xD). Pass to
 * `new Sensor(SENSOR.<part>, I2C1.device(0x44))`.
 */
export const SENSOR = {
  /** | — spi. Channels: ROTATION, RPM */
  "adi_ad2s1210": "adi_ad2s1210",
  /** ADE7978 Isolated energy metering chipset for polyphase shunt meters — spi. Channels: CURRENT, VOLTAGE */
  "adi_ade7978": "adi_ade7978",
  /** ADLTC2990 Quad I2C Voltage, Current and Temperature Monitor — i2c. Channels: AMBIENT_TEMP, CURRENT, DIE_TEMP, VOLTAGE */
  "adi_adltc2990": "adi_adltc2990",
  /** ADT7310 16-Bit digital SPI temperature sensor — spi. Channels: AMBIENT_TEMP */
  "adi_adt7310": "adi_adt7310",
  /** ADT7410 16-Bit digital I2C temperature sensor — i2c. Channels: AMBIENT_TEMP */
  "adi_adt7410": "adi_adt7410",
  /** ADT7420 16-Bit digital I2C temperature sensor — i2c (no driver channel scan) */
  "adi_adt7420": "adi_adt7420",
  /** ADT7422 16-Bit digital I2C temperature sensor — i2c (no driver channel scan) */
  "adi_adt7422": "adi_adt7422",
  /** ADXL345 3-axis I2C accelerometer — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z */
  "adi_adxl345": "adi_adxl345",
  /** ADXL355 3-axis accelerometer with I2C connection — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, AMBIENT_TEMP, DIE_TEMP */
  "adi_adxl355": "adi_adxl355",
  /** | — spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "adi_adxl362": "adi_adxl362",
  /** ADXL366 3-axis nanopower accelerometer, accessed through I2C bus — i2c+spi (no driver channel scan) */
  "adi_adxl366": "adi_adxl366",
  /** ADXL367 3-axis nanopower accelerometer, accessed through I2C bus — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "adi_adxl367": "adi_adxl367",
  /** ADXL372 3-axis high-g accelerometer, accessed through I2C bus — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z */
  "adi_adxl372": "adi_adxl372",
  /** MAX30210, a high-accuracy digital temperature sensor from Analog Devices. — i2c. Channels: AMBIENT_TEMP */
  "adi_max30210": "adi_max30210",
  /** Allegro ALS31300 3D Linear Hall Effect Sensor — i2c. Channels: AMBIENT_TEMP, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "allegro_als31300": "allegro_als31300",
  /** AMD SB Temperature Sensor Interface. — i2c. Channels: AMBIENT_TEMP */
  "amd_sb_tsi": "amd_sb_tsi",
  /** | — spi. Channels: ROTATION */
  "ams_as5048": "ams_as5048",
  /** | — i2c. Channels: ROTATION */
  "ams_as5600": "ams_as5600",
  /** | — i2c (no driver channel scan) */
  "ams_as6212": "ams_as6212",
  /** | — i2c (no driver channel scan) */
  "ams_as6221": "ams_as6221",
  /** CCS811 digital air quality sensor — i2c. Channels: CO2, CURRENT, VOC, VOLTAGE */
  "ams_ccs811": "ams_ccs811",
  /** | — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "ams_ens210": "ams_ens210",
  /** iAQ-core indoor air quality sensor — i2c. Channels: CO2, RESISTANCE, VOC */
  "ams_iaqcore": "ams_iaqcore",
  /** AMS TCS3400 Color Light-to-Digital Converter — i2c. Channels: BLUE, GREEN, LIGHT, RED */
  "ams_tcs3400": "ams_tcs3400",
  /** OSRAM ams TMD2620 Proximity Sensor — i2c. Channels: PROX */
  "ams_tmd2620": "ams_tmd2620",
  /** | — i2c. Channels: IR, LIGHT */
  "ams_tsl2540": "ams_tsl2540",
  /** | — i2c. Channels: LIGHT */
  "ams_tsl2561": "ams_tsl2561",
  /** | — i2c. Channels: IR, LIGHT */
  "ams_tsl2591": "ams_tsl2591",
  /** | — i2c. Channels: VOC */
  "aosong_ags10": "aosong_ags10",
  /** | — i2c (no driver channel scan) */
  "aosong_aht20": "aosong_aht20",
  /** | — i2c (no driver channel scan) */
  "aosong_am2301b": "aosong_am2301b",
  /** | — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "aosong_dht20": "aosong_dht20",
  /** | — i2c. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "asahi_kasei_ak8975": "asahi_kasei_ak8975",
  /** | — i2c. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "asahi_kasei_akm09918c": "asahi_kasei_akm09918c",
  /** APDS9253 ambient light, RGB — i2c. Channels: BLUE, GREEN, IR, RED */
  "avago_apds9253": "avago_apds9253",
  /** APDS9306 miniature Surface-Mount Digital Ambient Light Sensor. — i2c. Channels: LIGHT */
  "avago_apds9306": "avago_apds9306",
  /** APDS9960 digital proximity, ambient light, RGB, and gesture sensor — i2c. Channels: BLUE, GREEN, LIGHT, PROX, RED */
  "avago_apds9960": "avago_apds9960",
  /** | — spi. Channels: VOLTAGE */
  "avia_hx711_spi": "avia_hx711_spi",
  /** | — i2c. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "bosch_bma280": "bosch_bma280",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "bosch_bma4xx": "bosch_bma4xx",
  /** | — i2c. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "bosch_bmc150_magn": "bosch_bmc150_magn",
  /** BME280 integrated environmental sensor — i2c+spi. Channels: AMBIENT_TEMP, HUMIDITY, PRESS */
  "bosch_bme280": "bosch_bme280",
  /** | — i2c+spi. Channels: AMBIENT_TEMP, GAS_RES, HUMIDITY, PRESS */
  "bosch_bme680": "bosch_bme680",
  /** | — i2c. Channels: DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "bosch_bmg160": "bosch_bmg160",
  /** BMI08X Accel inertial measurement unit — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "bosch_bmi08x_accel": "bosch_bmi08x_accel",
  /** BMI08X Gyro inertial measurement unit — i2c+spi. Channels: GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "bosch_bmi08x_gyro": "bosch_bmi08x_gyro",
  /** BMI160 inertial measurement unit — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "bosch_bmi160": "bosch_bmi160",
  /**  — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "bosch_bmi270": "bosch_bmi270",
  /**  — spi. Channels: ACCEL_XYZ, DIE_TEMP, GYRO_XYZ */
  "bosch_bmi323": "bosch_bmi323",
  /** | — i2c+spi. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "bosch_bmm150": "bosch_bmm150",
  /** | — i2c. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "bosch_bmm350": "bosch_bmm350",
  /** | — i2c. Channels: DIE_TEMP, PRESS */
  "bosch_bmp180": "bosch_bmp180",
  /** | — i2c+spi. Channels: AMBIENT_TEMP, DIE_TEMP, PRESS */
  "bosch_bmp388": "bosch_bmp388",
  /** | — i2c+spi (no driver channel scan) */
  "bosch_bmp390": "bosch_bmp390",
  /** | — i2c. Channels: AMBIENT_TEMP, PRESS */
  "bosch_bmp581": "bosch_bmp581",
  /** | — spi. Channels: DISTANCE */
  "brcm_afbr_s50": "brcm_afbr_s50",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "fintek_f75303": "fintek_f75303",
  /** | — i2c. Channels: BLUE, GREEN, RED */
  "hamamatsu_s11059": "hamamatsu_s11059",
  /** Honeywell HMC5883L 3-axis magnetometer sensor — i2c. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "honeywell_hmc5883l": "honeywell_hmc5883l",
  /** | — i2c. Channels: PRESS */
  "honeywell_mpr": "honeywell_mpr",
  /** | — i2c. Channels: ALTITUDE, AMBIENT_TEMP, PRESS */
  "hoperf_hp206c": "hoperf_hp206c",
  /** | — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "hoperf_th02": "hoperf_th02",
  /** Infineon DPS310 temperature and pressure sensor — i2c. Channels: AMBIENT_TEMP, PRESS */
  "infineon_dps310": "infineon_dps310",
  /** ICM-40627 motion tracking device — i2c. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "invensense_icm40627": "invensense_icm40627",
  /** ICM-42370-P motion tracking device — i2c+spi (no driver channel scan) */
  "invensense_icm42370p": "invensense_icm42370p",
  /** ICM-42605 motion tracking device — spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "invensense_icm42605": "invensense_icm42605",
  /** ICM-42670-P motion tracking device — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "invensense_icm42670p": "invensense_icm42670p",
  /** ICM-42670-S motion tracking device — i2c+spi (no driver channel scan) */
  "invensense_icm42670s": "invensense_icm42670s",
  /**  — spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "invensense_icm4268x": "invensense_icm4268x",
  /** | — i2c+spi (no driver channel scan) */
  "invensense_icm45605": "invensense_icm45605",
  /** | — i2c+spi (no driver channel scan) */
  "invensense_icm45605s": "invensense_icm45605s",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "invensense_icm45686": "invensense_icm45686",
  /** | — i2c+spi (no driver channel scan) */
  "invensense_icm45686s": "invensense_icm45686s",
  /** | — i2c+spi (no driver channel scan) */
  "invensense_icm45688p": "invensense_icm45688p",
  /** ICP101xx High Accuracy, Low Power, Barometric Pressure and Temperature Sensors IC — i2c. Channels: ALTITUDE, AMBIENT_TEMP, PRESS */
  "invensense_icp101xx": "invensense_icp101xx",
  /** ICP201xx High Accuracy, Low Power, Barometric Pressure and Temperature Sensor IC — i2c+spi. Channels: ALTITUDE, AMBIENT_TEMP, PRESS */
  "invensense_icp201xx": "invensense_icp201xx",
  /** MPU-6000 motion tracking device — i2c. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "invensense_mpu6050": "invensense_mpu6050",
  /** | — i2c. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "invensense_mpu9250": "invensense_mpu9250",
  /** | — i2c. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "isentek_ist8310": "isentek_ist8310",
  /** | — i2c. Channels: IR, LIGHT */
  "isil_isl29035": "isil_isl29035",
  /** | — i2c (no driver channel scan) */
  "jedec_jc_42.4_temp": "jedec_jc_42.4_temp",
  /** LiteOn LTR-329 Digital Ambient Light Sensor — i2c (no driver channel scan) */
  "liteon_ltr329": "liteon_ltr329",
  /** LiteOn LTR-553 Digital Ambient Light and proximity sensor — i2c (no driver channel scan) */
  "liteon_ltr553": "liteon_ltr553",
  /** LiteOn F216A ambient light sensor — i2c. Channels: LIGHT */
  "liteon_ltrf216a": "liteon_ltrf216a",
  /** LM75 Digital Temperature Sensor with 2-Wire Interface. — i2c. Channels: AMBIENT_TEMP */
  "lm75": "lm75",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "lm77": "lm77",
  /** MB7040 ultrasonic distance sensor — i2c. Channels: DISTANCE */
  "maxbotix_mb7040": "maxbotix_mb7040",
  /** Maxim MAX17055 Fuel Gauge — i2c. Channels: CURRENT, GAUGE_AVG_CURRENT, GAUGE_CYCLE_COUNT, GAUGE_DESIGN_VOLTAGE, GAUGE_DESIRED_CHARGING_CURRENT, GAUGE_DESIRED_VOLTAGE, GAUGE_FULL_CHARGE_CAPACITY, GAUGE_NOM_AVAIL_CAPACITY, GAUGE_REMAINING_CHARGE_CAPACITY, GAUGE_STATE_OF_CHARGE, GAUGE_TEMP, GAUGE_TIME_TO_EMPTY, GAUGE_TIME_TO_FULL, GAUGE_VOLTAGE */
  "maxim_max17055": "maxim_max17055",
  /** Maxim MAX17262 Fuel Gauge — i2c. Channels: GAUGE_AVG_CURRENT, GAUGE_CYCLE_COUNT, GAUGE_DESIGN_VOLTAGE, GAUGE_DESIRED_CHARGING_CURRENT, GAUGE_DESIRED_VOLTAGE, GAUGE_FULL_CHARGE_CAPACITY, GAUGE_NOM_AVAIL_CAPACITY, GAUGE_REMAINING_CHARGE_CAPACITY, GAUGE_STATE_OF_CHARGE, GAUGE_TEMP, GAUGE_TIME_TO_EMPTY, GAUGE_TIME_TO_FULL, GAUGE_VOLTAGE */
  "maxim_max17262": "maxim_max17262",
  /** MAX30101 heart rate sensor — i2c. Channels: AMBIENT_LIGHT, DIE_TEMP, GREEN, IR, LIGHT, RED */
  "maxim_max30101": "maxim_max30101",
  /** MAX31855 SPI-based cold-junction compensated thermocouple-to-digital converter. — spi. Channels: AMBIENT_TEMP, DIE_TEMP */
  "maxim_max31855": "maxim_max31855",
  /** | — spi. Channels: AMBIENT_TEMP */
  "maxim_max31865": "maxim_max31865",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "maxim_max31875": "maxim_max31875",
  /** | — i2c. Channels: ACCEL_X, ACCEL_Y, ACCEL_Z, GREEN, IR, RED */
  "maxim_max32664c": "maxim_max32664c",
  /** | — i2c. Channels: LIGHT */
  "maxim_max44009": "maxim_max44009",
  /** MAX6675 K-thermocouple to digital converter — spi. Channels: AMBIENT_TEMP */
  "maxim_max6675": "maxim_max6675",
  /** | — i2c+spi. Channels: AMBIENT_TEMP, PRESS */
  "meas_ms5607": "meas_ms5607",
  /** TE Connectivity MS5837-02BA digital pressure sensor — i2c. Channels: AMBIENT_TEMP, PRESS */
  "meas_ms5837_02ba": "meas_ms5837_02ba",
  /** TE Connectivity MS5837-30BA digital pressure sensor — i2c (no driver channel scan) */
  "meas_ms5837_30ba": "meas_ms5837_30ba",
  /** | — i2c. Channels: AMBIENT_TEMP, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "melexis_mlx90394": "melexis_mlx90394",
  /** | — i2c. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z */
  "memsic_mc3419": "memsic_mc3419",
  /** MMC56X3 3-axis magnetic and temperature sensor — i2c. Channels: AMBIENT_TEMP, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "memsic_mmc56x3": "memsic_mmc56x3",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "microchip_mcp9600": "microchip_mcp9600",
  /** TCN75A ambient temperature sensor — i2c. Channels: AMBIENT_TEMP */
  "microchip_tcn75a": "microchip_tcn75a",
  /** LM95234 Quad Remote Diode and Local Temperature Sensor with SMBus Interface — i2c. Channels: AMBIENT_TEMP */
  "national_lm95234": "national_lm95234",
  /** FXAS21002 3-axis gyroscope sensor — i2c+spi. Channels: GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "nxp_fxas21002": "nxp_fxas21002",
  /** FXLS8974 3-axis accelerometer sensor — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, AMBIENT_TEMP */
  "nxp_fxls8974": "nxp_fxls8974",
  /** FXOS8700 6-axis accelerometer/magnetometer sensor — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "nxp_fxos8700": "nxp_fxos8700",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "nxp_p3t1755": "nxp_p3t1755",
  /** | — i2c. Channels: AMBIENT_TEMP, PRESS */
  "omron_2smpb_02e": "omron_2smpb_02e",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "onnn_nct75": "onnn_nct75",
  /** Panasonic AMG88XX 8x8 (64) pixel infrared array sensor — i2c. Channels: AMBIENT_TEMP */
  "panasonic_amg88xx": "panasonic_amg88xx",
  /** | — i2c. Channels: PROX */
  "phosense_xbr818": "phosense_xbr818",
  /** PA3905 optical flow sensor — spi. Channels: POS_DX, POS_DXYZ, POS_DY */
  "pixart_paa3905": "pixart_paa3905",
  /** Pixart PAJ7620 gesture sensor — i2c (no driver channel scan) */
  "pixart_paj7620": "pixart_paj7620",
  /** PAT9136 optical flow sensor — spi. Channels: POS_DX, POS_DXYZ, POS_DY */
  "pixart_pat9136": "pixart_pat9136",
  /** | — i2c+spi. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "pni_rm3100": "pni_rm3100",
  /** QST QMI8658A 6-axis IMU — i2c. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "qst_qmi8658a": "qst_qmi8658a",
  /** Renesas HS300x humidity and temperature sensor — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "renesas_hs300x": "renesas_hs300x",
  /** Renesas HS400x humidity and temperature sensor — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "renesas_hs400x": "renesas_hs400x",
  /** Rohm BH1730 ambient light sensor. — i2c. Channels: LIGHT */
  "rohm_bh1730": "rohm_bh1730",
  /** Rohm BH1750 ambient light sensor. — i2c. Channels: LIGHT */
  "rohm_bh1750": "rohm_bh1750",
  /** Rohm BH1790 Optical Sensor for Heart Rate Monitor IC. — i2c. Channels: GREEN, LIGHT */
  "rohm_bh1790": "rohm_bh1790",
  /** SBS 1.1 compliant fuel gauge (http://www.sbs-forum.org/specs) — i2c. Channels: GAUGE_AVG_CURRENT, GAUGE_CYCLE_COUNT, GAUGE_FULL_AVAIL_CAPACITY, GAUGE_FULL_CHARGE_CAPACITY, GAUGE_NOM_AVAIL_CAPACITY, GAUGE_REMAINING_CHARGE_CAPACITY, GAUGE_STATE_OF_CHARGE, GAUGE_TEMP, GAUGE_TIME_TO_EMPTY, GAUGE_TIME_TO_FULL, GAUGE_VOLTAGE */
  "sbs_sbs_gauge": "sbs_sbs_gauge",
  /** | — i2c+spi. Channels: CO2, VOC */
  "sciosense_ens160": "sciosense_ens160",
  /** | — i2c. Channels: PM_10, PM_1_0, PM_2_5 */
  "seeed_hm330x": "seeed_hm330x",
  /** | — i2c. Channels: PROX */
  "semtech_sx9500": "semtech_sx9500",
  /** Sensirion SCD4x temperature sensor — i2c. Channels: AMBIENT_TEMP, CO2, HUMIDITY */
  "sensirion_scd40": "sensirion_scd40",
  /** Sensirion SCD4x temperature sensor — i2c (no driver channel scan) */
  "sensirion_scd41": "sensirion_scd41",
  /** Sensirion SGP40 Multipixel Gas Sensor — i2c. Channels: GAS_RES */
  "sensirion_sgp40": "sensirion_sgp40",
  /** | — i2c (no driver channel scan) */
  "sensirion_sht21": "sensirion_sht21",
  /** Sensirion Humidity SHT3x-DIS humidity and temperature sensor — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "sensirion_sht3xd": "sensirion_sht3xd",
  /** Sensirion SHT4x humidity and temperature sensor — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "sensirion_sht4x": "sensirion_sht4x",
  /** | — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "sensirion_shtcx": "sensirion_shtcx",
  /** | — i2c. Channels: AMBIENT_TEMP, CO2, HUMIDITY */
  "sensirion_stcc4": "sensirion_stcc4",
  /** Sensirion STS4x temperature sensor — i2c. Channels: AMBIENT_TEMP */
  "sensirion_sts4x": "sensirion_sts4x",
  /** Si7055 temperature sensor — i2c. Channels: AMBIENT_TEMP */
  "silabs_si7055": "silabs_si7055",
  /** Si7060 temperature sensor — i2c. Channels: AMBIENT_TEMP */
  "silabs_si7060": "silabs_si7060",
  /** Si7210 hall effect magnetic position and temperature sensor — i2c. Channels: AMBIENT_TEMP, MAGN_Z */
  "silabs_si7210": "silabs_si7210",
  /** | — i2c+spi. Channels: AMBIENT_TEMP, HUMIDITY */
  "st_hts221": "st_hts221",
  /** | — spi. Channels: GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "st_i3g4250d": "st_i3g4250d",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z */
  "st_iis2dh": "st_iis2dh",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z */
  "st_iis2dlpc": "st_iis2dlpc",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, AMBIENT_TEMP, DIE_TEMP, HUMIDITY, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z, PRESS */
  "st_iis2iclx": "st_iis2iclx",
  /** | — i2c+spi. Channels: DIE_TEMP, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "st_iis2mdc": "st_iis2mdc",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z */
  "st_iis328dq": "st_iis328dq",
  /** | — spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z */
  "st_iis3dhhc": "st_iis3dhhc",
  /** | — spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "st_iis3dwb": "st_iis3dwb",
  /** | — i2c+spi. Channels: AMBIENT_TEMP, PRESS */
  "st_ilps22qs": "st_ilps22qs",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, AMBIENT_TEMP, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z, HUMIDITY, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z, PRESS */
  "st_ism330dhcx": "st_ism330dhcx",
  /** | — i2c+spi (no driver channel scan) */
  "st_ism6hg256x": "st_ism6hg256x",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "st_lis2de12": "st_lis2de12",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "st_lis2dh": "st_lis2dh",
  /** STMicroelectronics LIS2DH12 3-axis accelerometer — i2c (no driver channel scan) */
  "st_lis2dh12": "st_lis2dh12",
  /** STMicroelectronics LIS2DS12 3-axis accelerometer — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "st_lis2ds12": "st_lis2ds12",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z */
  "st_lis2du12": "st_lis2du12",
  /** STMicroelectronics LIS2DUX12 3-axis accelerometer — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "st_lis2dux12": "st_lis2dux12",
  /** STMicroelectronics LIS2DUXS12 3-axis accelerometer — i2c+spi (no driver channel scan) */
  "st_lis2duxs12": "st_lis2duxs12",
  /** STMicroelectronics LIS2DW12 3-axis accelerometer — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP */
  "st_lis2dw12": "st_lis2dw12",
  /** | — i2c+spi. Channels: DIE_TEMP, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "st_lis2mdl": "st_lis2mdl",
  /** STMicroelectronics LIS3DH 3-axis accelerometer — i2c (no driver channel scan) */
  "st_lis3dh": "st_lis3dh",
  /** STMicroelectronics LIS3MDL magnetometer — i2c. Channels: DIE_TEMP, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "st_lis3mdl_magn": "st_lis3mdl_magn",
  /** | — i2c+spi (no driver channel scan) */
  "st_lps22df": "st_lps22df",
  /** STMicroelectronics LPS22HB pressure sensor — i2c. Channels: AMBIENT_TEMP, PRESS */
  "st_lps22hb_press": "st_lps22hb_press",
  /** | — i2c+spi. Channels: AMBIENT_TEMP, PRESS */
  "st_lps22hh": "st_lps22hh",
  /** STMicroelectronics LPS25HB pressure sensor — i2c. Channels: AMBIENT_TEMP, PRESS */
  "st_lps25hb_press": "st_lps25hb_press",
  /** | — i2c (no driver channel scan) */
  "st_lps28dfw": "st_lps28dfw",
  /** | — i2c+spi (no driver channel scan) */
  "st_lsm303agr_accel": "st_lsm303agr_accel",
  /** LSM303DLHC acceleration sensor — i2c (no driver channel scan) */
  "st_lsm303dlhc_accel": "st_lsm303dlhc_accel",
  /** STMicroelectronics LSM303DLHC magnetometer sensor — i2c. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "st_lsm303dlhc_magn": "st_lsm303dlhc_magn",
  /** STMicroelectronics LSM6DS0 6-axis accelerometer and gyrometer — i2c. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "st_lsm6ds0": "st_lsm6ds0",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, AMBIENT_TEMP, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z, PRESS */
  "st_lsm6dsl": "st_lsm6dsl",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, AMBIENT_TEMP, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z, HUMIDITY, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z, PRESS */
  "st_lsm6dso": "st_lsm6dso",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, AMBIENT_TEMP, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z, HUMIDITY, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z, PRESS */
  "st_lsm6dso16is": "st_lsm6dso16is",
  /** | — i2c+spi (no driver channel scan) */
  "st_lsm6dso32": "st_lsm6dso32",
  /** | — i2c+spi (no driver channel scan) */
  "st_lsm6dsv16x": "st_lsm6dsv16x",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GBIAS_XYZ, GYRO_XYZ */
  "st_lsm6dsv320x": "st_lsm6dsv320x",
  /** | — i2c+spi (no driver channel scan) */
  "st_lsm6dsv32x": "st_lsm6dsv32x",
  /** | — i2c+spi (no driver channel scan) */
  "st_lsm6dsv80x": "st_lsm6dsv80x",
  /** STMicroelectronics LSM9DS0-GYRO 3-axis gyro — i2c. Channels: GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "st_lsm9ds0_gyro": "st_lsm9ds0_gyro",
  /** STMicroelectronics LSM9DS0 3-axis accelerometer + magnetometer — i2c. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "st_lsm9ds0_mfd": "st_lsm9ds0_mfd",
  /** | — i2c. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, DIE_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "st_lsm9ds1": "st_lsm9ds1",
  /** | — i2c. Channels: MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z */
  "st_lsm9ds1_mag": "st_lsm9ds1_mag",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "st_stts22h": "st_stts22h",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "st_stts751": "st_stts751",
  /** STMicroelectronics VL53L0X Time of Flight sensor — i2c. Channels: DISTANCE, PROX */
  "st_vl53l0x": "st_vl53l0x",
  /** STMicroelectronics VL53L1X Time of Flight sensor — i2c. Channels: DISTANCE */
  "st_vl53l1x": "st_vl53l1x",
  /** Texas Instruments BQ274xx Fuel Gauge — i2c. Channels: GAUGE_AVG_CURRENT, GAUGE_AVG_POWER, GAUGE_FULL_AVAIL_CAPACITY, GAUGE_FULL_CHARGE_CAPACITY, GAUGE_MAX_LOAD_CURRENT, GAUGE_NOM_AVAIL_CAPACITY, GAUGE_REMAINING_CHARGE_CAPACITY, GAUGE_STATE_OF_CHARGE, GAUGE_STATE_OF_HEALTH, GAUGE_STDBY_CURRENT, GAUGE_TEMP, GAUGE_VOLTAGE */
  "ti_bq274xx": "ti_bq274xx",
  /** Texas Instruments FDC2X1X capacitive sensor — i2c (no driver channel scan) */
  "ti_fdc2x1x": "ti_fdc2x1x",
  /** Texas Instruments temperature and humidity sensor (e.g. HDC1008) — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "ti_hdc": "ti_hdc",
  /** Texas Instruments HDC302X Temperature and Humidity Sensor — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "ti_hdc302x": "ti_hdc302x",
  /** Texas Instruments Bidirectional Current/Power Sensor — i2c. Channels: CURRENT, POWER, VOLTAGE */
  "ti_ina219": "ti_ina219",
  /** Texas Instruments INA3221 Triple-Channel Current/Power Monitor — i2c. Channels: CURRENT, POWER, VOLTAGE */
  "ti_ina3221": "ti_ina3221",
  /** Texas Instruments Bidirectional Current/Power Sensor — i2c. Channels: CURRENT, DIE_TEMP, POWER, VOLTAGE */
  "ti_ina7xx": "ti_ina7xx",
  /** Texas Instruments TMAG5170 high-precision, linear 3D Hall-effect sensor. — spi. Channels: AMBIENT_TEMP, MAGN_X, MAGN_XYZ, MAGN_Y, MAGN_Z, ROTATION */
  "ti_tmag5170": "ti_tmag5170",
  /** | — i2c (no driver channel scan) */
  "ti_tmag5273": "ti_tmag5273",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "ti_tmp007": "ti_tmp007",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "ti_tmp1075": "ti_tmp1075",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "ti_tmp108": "ti_tmp108",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "ti_tmp112": "ti_tmp112",
  /** Texas Instruments TMP114 temperature sensor — i2c. Channels: AMBIENT_TEMP */
  "ti_tmp114": "ti_tmp114",
  /** Texas Instruments TMP11X temperature sensor — i2c. Channels: AMBIENT_TEMP */
  "ti_tmp11x": "ti_tmp11x",
  /** Texas Instruments TMP435 temperature sensor — i2c. Channels: AMBIENT_TEMP, DIE_TEMP */
  "ti_tmp435": "ti_tmp435",
  /** | — i2c. Channels: PROX */
  "vishay_vcnl36825t": "vishay_vcnl36825t",
  /** | — i2c. Channels: LIGHT, PROX */
  "vishay_vcnl4040": "vishay_vcnl4040",
  /** | — i2c. Channels: LIGHT */
  "vishay_veml6031": "vishay_veml6031",
  /** | — i2c. Channels: BLUE, GREEN, IR, LIGHT, RED */
  "vishay_veml6046": "vishay_veml6046",
  /** | — i2c. Channels: LIGHT */
  "vishay_veml7700": "vishay_veml7700",
  /** | — i2c. Channels: AMBIENT_TEMP, HUMIDITY */
  "we_wsen_hids_2525020210002": "we_wsen_hids_2525020210002",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, AMBIENT_TEMP, GYRO_X, GYRO_XYZ, GYRO_Y, GYRO_Z */
  "we_wsen_isds_2536030320001": "we_wsen_isds_2536030320001",
  /** | — i2c+spi. Channels: ACCEL_X, ACCEL_XYZ, ACCEL_Y, ACCEL_Z, AMBIENT_TEMP */
  "we_wsen_itds_2533020201601": "we_wsen_itds_2533020201601",
  /** | — i2c+spi. Channels: AMBIENT_TEMP, PRESS */
  "we_wsen_pads_2511020213301": "we_wsen_pads_2511020213301",
  /** | — i2c+spi (no driver channel scan) */
  "we_wsen_pdms_25131308XXX05": "we_wsen_pdms_25131308XXX05",
  /** | — i2c (no driver channel scan) */
  "we_wsen_pdus_25131308XXXXX": "we_wsen_pdus_25131308XXXXX",
  /** | — i2c. Channels: AMBIENT_TEMP */
  "we_wsen_tids_2521020222501": "we_wsen_tids_2521020222501",
} as const;

/** Sensor part token value (e.g. 'sensirion_sht3xd'). */
export type SensorToken = string;

/**
 * Sensor channel names ('AMBIENT_TEMP', 'HUMIDITY', …) — a string enum so
 * the editor offers CHAN members directly while typing inside
 * sensor.get(...). The member value equals its name.
 */
export enum CHAN {
  ACCEL_X = "ACCEL_X",
  ACCEL_Y = "ACCEL_Y",
  ACCEL_Z = "ACCEL_Z",
  ACCEL_XYZ = "ACCEL_XYZ",
  GYRO_X = "GYRO_X",
  GYRO_Y = "GYRO_Y",
  GYRO_Z = "GYRO_Z",
  GYRO_XYZ = "GYRO_XYZ",
  MAGN_X = "MAGN_X",
  MAGN_Y = "MAGN_Y",
  MAGN_Z = "MAGN_Z",
  MAGN_XYZ = "MAGN_XYZ",
  DIE_TEMP = "DIE_TEMP",
  AMBIENT_TEMP = "AMBIENT_TEMP",
  PRESS = "PRESS",
  PROX = "PROX",
  HUMIDITY = "HUMIDITY",
  AMBIENT_LIGHT = "AMBIENT_LIGHT",
  LIGHT = "LIGHT",
  IR = "IR",
  RED = "RED",
  GREEN = "GREEN",
  BLUE = "BLUE",
  ALTITUDE = "ALTITUDE",
  PM_1_0_CF = "PM_1_0_CF",
  PM_2_5_CF = "PM_2_5_CF",
  PM_10_CF = "PM_10_CF",
  PM_1_0 = "PM_1_0",
  PM_2_5 = "PM_2_5",
  PM_10 = "PM_10",
  PM_0_3_COUNT = "PM_0_3_COUNT",
  PM_0_5_COUNT = "PM_0_5_COUNT",
  PM_1_0_COUNT = "PM_1_0_COUNT",
  PM_2_5_COUNT = "PM_2_5_COUNT",
  PM_5_COUNT = "PM_5_COUNT",
  PM_10_COUNT = "PM_10_COUNT",
  DISTANCE = "DISTANCE",
  CO2 = "CO2",
  O2 = "O2",
  VOC = "VOC",
  GAS_RES = "GAS_RES",
  FLOW_RATE = "FLOW_RATE",
  VOLTAGE = "VOLTAGE",
  VSHUNT = "VSHUNT",
  CURRENT = "CURRENT",
  POWER = "POWER",
  RESISTANCE = "RESISTANCE",
  ROTATION = "ROTATION",
  POS_DX = "POS_DX",
  POS_DY = "POS_DY",
  POS_DZ = "POS_DZ",
  POS_DXYZ = "POS_DXYZ",
  RPM = "RPM",
  FREQUENCY = "FREQUENCY",
  GAUGE_VOLTAGE = "GAUGE_VOLTAGE",
  GAUGE_AVG_CURRENT = "GAUGE_AVG_CURRENT",
  GAUGE_STDBY_CURRENT = "GAUGE_STDBY_CURRENT",
  GAUGE_MAX_LOAD_CURRENT = "GAUGE_MAX_LOAD_CURRENT",
  GAUGE_TEMP = "GAUGE_TEMP",
  GAUGE_STATE_OF_CHARGE = "GAUGE_STATE_OF_CHARGE",
  GAUGE_FULL_CHARGE_CAPACITY = "GAUGE_FULL_CHARGE_CAPACITY",
  GAUGE_REMAINING_CHARGE_CAPACITY = "GAUGE_REMAINING_CHARGE_CAPACITY",
  GAUGE_NOM_AVAIL_CAPACITY = "GAUGE_NOM_AVAIL_CAPACITY",
  GAUGE_FULL_AVAIL_CAPACITY = "GAUGE_FULL_AVAIL_CAPACITY",
  GAUGE_AVG_POWER = "GAUGE_AVG_POWER",
  GAUGE_STATE_OF_HEALTH = "GAUGE_STATE_OF_HEALTH",
  GAUGE_TIME_TO_EMPTY = "GAUGE_TIME_TO_EMPTY",
  GAUGE_TIME_TO_FULL = "GAUGE_TIME_TO_FULL",
  GAUGE_CYCLE_COUNT = "GAUGE_CYCLE_COUNT",
  GAUGE_DESIGN_VOLTAGE = "GAUGE_DESIGN_VOLTAGE",
  GAUGE_DESIRED_VOLTAGE = "GAUGE_DESIRED_VOLTAGE",
  GAUGE_DESIRED_CHARGING_CURRENT = "GAUGE_DESIRED_CHARGING_CURRENT",
  GAME_ROTATION_VECTOR = "GAME_ROTATION_VECTOR",
  GRAVITY_VECTOR = "GRAVITY_VECTOR",
  GBIAS_XYZ = "GBIAS_XYZ",
  ENCODER_COUNT = "ENCODER_COUNT",
  COMMON_COUNT = "COMMON_COUNT",
  MAX = "MAX",
}

/** Channel name value (a CHAN member, see CHAN). */
export type SensorChannelName = string;

/**
 * Per-part channel unions — the narrowing surface for Sensor<P>.get():
 * new Sensor(SENSOR.sensirion_sht3xd, …).get( completes exactly this
 * part's channels and rejects the rest at the editor. Keyed by the SENSOR
 * token value (the underscored compatible).
 */
export type SensorChannelOf = {
  "adi_ad2s1210": CHAN.ROTATION | CHAN.RPM;
  "adi_ade7978": CHAN.CURRENT | CHAN.VOLTAGE;
  "adi_adltc2990": CHAN.AMBIENT_TEMP | CHAN.CURRENT | CHAN.DIE_TEMP | CHAN.VOLTAGE;
  "adi_adt7310": CHAN.AMBIENT_TEMP;
  "adi_adt7410": CHAN.AMBIENT_TEMP;
  "adi_adt7420": SensorChannelName;
  "adi_adt7422": SensorChannelName;
  "adi_adxl345": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z;
  "adi_adxl355": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.AMBIENT_TEMP | CHAN.DIE_TEMP;
  "adi_adxl362": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "adi_adxl366": SensorChannelName;
  "adi_adxl367": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "adi_adxl372": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z;
  "adi_max30210": CHAN.AMBIENT_TEMP;
  "allegro_als31300": CHAN.AMBIENT_TEMP | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "amd_sb_tsi": CHAN.AMBIENT_TEMP;
  "ams_as5048": CHAN.ROTATION;
  "ams_as5600": CHAN.ROTATION;
  "ams_as6212": SensorChannelName;
  "ams_as6221": SensorChannelName;
  "ams_ccs811": CHAN.CO2 | CHAN.CURRENT | CHAN.VOC | CHAN.VOLTAGE;
  "ams_ens210": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "ams_iaqcore": CHAN.CO2 | CHAN.RESISTANCE | CHAN.VOC;
  "ams_tcs3400": CHAN.BLUE | CHAN.GREEN | CHAN.LIGHT | CHAN.RED;
  "ams_tmd2620": CHAN.PROX;
  "ams_tsl2540": CHAN.IR | CHAN.LIGHT;
  "ams_tsl2561": CHAN.LIGHT;
  "ams_tsl2591": CHAN.IR | CHAN.LIGHT;
  "aosong_ags10": CHAN.VOC;
  "aosong_aht20": SensorChannelName;
  "aosong_am2301b": SensorChannelName;
  "aosong_dht20": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "asahi_kasei_ak8975": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "asahi_kasei_akm09918c": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "avago_apds9253": CHAN.BLUE | CHAN.GREEN | CHAN.IR | CHAN.RED;
  "avago_apds9306": CHAN.LIGHT;
  "avago_apds9960": CHAN.BLUE | CHAN.GREEN | CHAN.LIGHT | CHAN.PROX | CHAN.RED;
  "avia_hx711_spi": CHAN.VOLTAGE;
  "bosch_bma280": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "bosch_bma4xx": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "bosch_bmc150_magn": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "bosch_bme280": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY | CHAN.PRESS;
  "bosch_bme680": CHAN.AMBIENT_TEMP | CHAN.GAS_RES | CHAN.HUMIDITY | CHAN.PRESS;
  "bosch_bmg160": CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "bosch_bmi08x_accel": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "bosch_bmi08x_gyro": CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "bosch_bmi160": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "bosch_bmi270": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "bosch_bmi323": CHAN.ACCEL_XYZ | CHAN.DIE_TEMP | CHAN.GYRO_XYZ;
  "bosch_bmm150": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "bosch_bmm350": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "bosch_bmp180": CHAN.DIE_TEMP | CHAN.PRESS;
  "bosch_bmp388": CHAN.AMBIENT_TEMP | CHAN.DIE_TEMP | CHAN.PRESS;
  "bosch_bmp390": SensorChannelName;
  "bosch_bmp581": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "brcm_afbr_s50": CHAN.DISTANCE;
  "fintek_f75303": CHAN.AMBIENT_TEMP;
  "hamamatsu_s11059": CHAN.BLUE | CHAN.GREEN | CHAN.RED;
  "honeywell_hmc5883l": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "honeywell_mpr": CHAN.PRESS;
  "hoperf_hp206c": CHAN.ALTITUDE | CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "hoperf_th02": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "infineon_dps310": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "invensense_icm40627": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "invensense_icm42370p": SensorChannelName;
  "invensense_icm42605": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "invensense_icm42670p": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "invensense_icm42670s": SensorChannelName;
  "invensense_icm4268x": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "invensense_icm45605": SensorChannelName;
  "invensense_icm45605s": SensorChannelName;
  "invensense_icm45686": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "invensense_icm45686s": SensorChannelName;
  "invensense_icm45688p": SensorChannelName;
  "invensense_icp101xx": CHAN.ALTITUDE | CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "invensense_icp201xx": CHAN.ALTITUDE | CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "invensense_mpu6050": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "invensense_mpu9250": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "isentek_ist8310": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "isil_isl29035": CHAN.IR | CHAN.LIGHT;
  "jedec_jc_42.4_temp": SensorChannelName;
  "liteon_ltr329": SensorChannelName;
  "liteon_ltr553": SensorChannelName;
  "liteon_ltrf216a": CHAN.LIGHT;
  "lm75": CHAN.AMBIENT_TEMP;
  "lm77": CHAN.AMBIENT_TEMP;
  "maxbotix_mb7040": CHAN.DISTANCE;
  "maxim_max17055": CHAN.CURRENT | CHAN.GAUGE_AVG_CURRENT | CHAN.GAUGE_CYCLE_COUNT | CHAN.GAUGE_DESIGN_VOLTAGE | CHAN.GAUGE_DESIRED_CHARGING_CURRENT | CHAN.GAUGE_DESIRED_VOLTAGE | CHAN.GAUGE_FULL_CHARGE_CAPACITY | CHAN.GAUGE_NOM_AVAIL_CAPACITY | CHAN.GAUGE_REMAINING_CHARGE_CAPACITY | CHAN.GAUGE_STATE_OF_CHARGE | CHAN.GAUGE_TEMP | CHAN.GAUGE_TIME_TO_EMPTY | CHAN.GAUGE_TIME_TO_FULL | CHAN.GAUGE_VOLTAGE;
  "maxim_max17262": CHAN.GAUGE_AVG_CURRENT | CHAN.GAUGE_CYCLE_COUNT | CHAN.GAUGE_DESIGN_VOLTAGE | CHAN.GAUGE_DESIRED_CHARGING_CURRENT | CHAN.GAUGE_DESIRED_VOLTAGE | CHAN.GAUGE_FULL_CHARGE_CAPACITY | CHAN.GAUGE_NOM_AVAIL_CAPACITY | CHAN.GAUGE_REMAINING_CHARGE_CAPACITY | CHAN.GAUGE_STATE_OF_CHARGE | CHAN.GAUGE_TEMP | CHAN.GAUGE_TIME_TO_EMPTY | CHAN.GAUGE_TIME_TO_FULL | CHAN.GAUGE_VOLTAGE;
  "maxim_max30101": CHAN.AMBIENT_LIGHT | CHAN.DIE_TEMP | CHAN.GREEN | CHAN.IR | CHAN.LIGHT | CHAN.RED;
  "maxim_max31855": CHAN.AMBIENT_TEMP | CHAN.DIE_TEMP;
  "maxim_max31865": CHAN.AMBIENT_TEMP;
  "maxim_max31875": CHAN.AMBIENT_TEMP;
  "maxim_max32664c": CHAN.ACCEL_X | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.GREEN | CHAN.IR | CHAN.RED;
  "maxim_max44009": CHAN.LIGHT;
  "maxim_max6675": CHAN.AMBIENT_TEMP;
  "meas_ms5607": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "meas_ms5837_02ba": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "meas_ms5837_30ba": SensorChannelName;
  "melexis_mlx90394": CHAN.AMBIENT_TEMP | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "memsic_mc3419": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z;
  "memsic_mmc56x3": CHAN.AMBIENT_TEMP | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "microchip_mcp9600": CHAN.AMBIENT_TEMP;
  "microchip_tcn75a": CHAN.AMBIENT_TEMP;
  "national_lm95234": CHAN.AMBIENT_TEMP;
  "nxp_fxas21002": CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "nxp_fxls8974": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.AMBIENT_TEMP;
  "nxp_fxos8700": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "nxp_p3t1755": CHAN.AMBIENT_TEMP;
  "omron_2smpb_02e": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "onnn_nct75": CHAN.AMBIENT_TEMP;
  "panasonic_amg88xx": CHAN.AMBIENT_TEMP;
  "phosense_xbr818": CHAN.PROX;
  "pixart_paa3905": CHAN.POS_DX | CHAN.POS_DXYZ | CHAN.POS_DY;
  "pixart_paj7620": SensorChannelName;
  "pixart_pat9136": CHAN.POS_DX | CHAN.POS_DXYZ | CHAN.POS_DY;
  "pni_rm3100": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "qst_qmi8658a": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "renesas_hs300x": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "renesas_hs400x": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "rohm_bh1730": CHAN.LIGHT;
  "rohm_bh1750": CHAN.LIGHT;
  "rohm_bh1790": CHAN.GREEN | CHAN.LIGHT;
  "sbs_sbs_gauge": CHAN.GAUGE_AVG_CURRENT | CHAN.GAUGE_CYCLE_COUNT | CHAN.GAUGE_FULL_AVAIL_CAPACITY | CHAN.GAUGE_FULL_CHARGE_CAPACITY | CHAN.GAUGE_NOM_AVAIL_CAPACITY | CHAN.GAUGE_REMAINING_CHARGE_CAPACITY | CHAN.GAUGE_STATE_OF_CHARGE | CHAN.GAUGE_TEMP | CHAN.GAUGE_TIME_TO_EMPTY | CHAN.GAUGE_TIME_TO_FULL | CHAN.GAUGE_VOLTAGE;
  "sciosense_ens160": CHAN.CO2 | CHAN.VOC;
  "seeed_hm330x": CHAN.PM_10 | CHAN.PM_1_0 | CHAN.PM_2_5;
  "semtech_sx9500": CHAN.PROX;
  "sensirion_scd40": CHAN.AMBIENT_TEMP | CHAN.CO2 | CHAN.HUMIDITY;
  "sensirion_scd41": SensorChannelName;
  "sensirion_sgp40": CHAN.GAS_RES;
  "sensirion_sht21": SensorChannelName;
  "sensirion_sht3xd": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "sensirion_sht4x": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "sensirion_shtcx": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "sensirion_stcc4": CHAN.AMBIENT_TEMP | CHAN.CO2 | CHAN.HUMIDITY;
  "sensirion_sts4x": CHAN.AMBIENT_TEMP;
  "silabs_si7055": CHAN.AMBIENT_TEMP;
  "silabs_si7060": CHAN.AMBIENT_TEMP;
  "silabs_si7210": CHAN.AMBIENT_TEMP | CHAN.MAGN_Z;
  "st_hts221": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "st_i3g4250d": CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "st_iis2dh": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z;
  "st_iis2dlpc": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z;
  "st_iis2iclx": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.AMBIENT_TEMP | CHAN.DIE_TEMP | CHAN.HUMIDITY | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z | CHAN.PRESS;
  "st_iis2mdc": CHAN.DIE_TEMP | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "st_iis328dq": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z;
  "st_iis3dhhc": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z;
  "st_iis3dwb": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "st_ilps22qs": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "st_ism330dhcx": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.AMBIENT_TEMP | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z | CHAN.HUMIDITY | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z | CHAN.PRESS;
  "st_ism6hg256x": SensorChannelName;
  "st_lis2de12": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "st_lis2dh": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "st_lis2dh12": SensorChannelName;
  "st_lis2ds12": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "st_lis2du12": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z;
  "st_lis2dux12": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "st_lis2duxs12": SensorChannelName;
  "st_lis2dw12": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP;
  "st_lis2mdl": CHAN.DIE_TEMP | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "st_lis3dh": SensorChannelName;
  "st_lis3mdl_magn": CHAN.DIE_TEMP | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "st_lps22df": SensorChannelName;
  "st_lps22hb_press": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "st_lps22hh": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "st_lps25hb_press": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "st_lps28dfw": SensorChannelName;
  "st_lsm303agr_accel": SensorChannelName;
  "st_lsm303dlhc_accel": SensorChannelName;
  "st_lsm303dlhc_magn": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "st_lsm6ds0": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "st_lsm6dsl": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.AMBIENT_TEMP | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z | CHAN.PRESS;
  "st_lsm6dso": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.AMBIENT_TEMP | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z | CHAN.HUMIDITY | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z | CHAN.PRESS;
  "st_lsm6dso16is": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.AMBIENT_TEMP | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z | CHAN.HUMIDITY | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z | CHAN.PRESS;
  "st_lsm6dso32": SensorChannelName;
  "st_lsm6dsv16x": SensorChannelName;
  "st_lsm6dsv320x": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GBIAS_XYZ | CHAN.GYRO_XYZ;
  "st_lsm6dsv32x": SensorChannelName;
  "st_lsm6dsv80x": SensorChannelName;
  "st_lsm9ds0_gyro": CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "st_lsm9ds0_mfd": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "st_lsm9ds1": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.DIE_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "st_lsm9ds1_mag": CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z;
  "st_stts22h": CHAN.AMBIENT_TEMP;
  "st_stts751": CHAN.AMBIENT_TEMP;
  "st_vl53l0x": CHAN.DISTANCE | CHAN.PROX;
  "st_vl53l1x": CHAN.DISTANCE;
  "ti_bq274xx": CHAN.GAUGE_AVG_CURRENT | CHAN.GAUGE_AVG_POWER | CHAN.GAUGE_FULL_AVAIL_CAPACITY | CHAN.GAUGE_FULL_CHARGE_CAPACITY | CHAN.GAUGE_MAX_LOAD_CURRENT | CHAN.GAUGE_NOM_AVAIL_CAPACITY | CHAN.GAUGE_REMAINING_CHARGE_CAPACITY | CHAN.GAUGE_STATE_OF_CHARGE | CHAN.GAUGE_STATE_OF_HEALTH | CHAN.GAUGE_STDBY_CURRENT | CHAN.GAUGE_TEMP | CHAN.GAUGE_VOLTAGE;
  "ti_fdc2x1x": SensorChannelName;
  "ti_hdc": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "ti_hdc302x": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "ti_ina219": CHAN.CURRENT | CHAN.POWER | CHAN.VOLTAGE;
  "ti_ina3221": CHAN.CURRENT | CHAN.POWER | CHAN.VOLTAGE;
  "ti_ina7xx": CHAN.CURRENT | CHAN.DIE_TEMP | CHAN.POWER | CHAN.VOLTAGE;
  "ti_tmag5170": CHAN.AMBIENT_TEMP | CHAN.MAGN_X | CHAN.MAGN_XYZ | CHAN.MAGN_Y | CHAN.MAGN_Z | CHAN.ROTATION;
  "ti_tmag5273": SensorChannelName;
  "ti_tmp007": CHAN.AMBIENT_TEMP;
  "ti_tmp1075": CHAN.AMBIENT_TEMP;
  "ti_tmp108": CHAN.AMBIENT_TEMP;
  "ti_tmp112": CHAN.AMBIENT_TEMP;
  "ti_tmp114": CHAN.AMBIENT_TEMP;
  "ti_tmp11x": CHAN.AMBIENT_TEMP;
  "ti_tmp435": CHAN.AMBIENT_TEMP | CHAN.DIE_TEMP;
  "vishay_vcnl36825t": CHAN.PROX;
  "vishay_vcnl4040": CHAN.LIGHT | CHAN.PROX;
  "vishay_veml6031": CHAN.LIGHT;
  "vishay_veml6046": CHAN.BLUE | CHAN.GREEN | CHAN.IR | CHAN.LIGHT | CHAN.RED;
  "vishay_veml7700": CHAN.LIGHT;
  "we_wsen_hids_2525020210002": CHAN.AMBIENT_TEMP | CHAN.HUMIDITY;
  "we_wsen_isds_2536030320001": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.AMBIENT_TEMP | CHAN.GYRO_X | CHAN.GYRO_XYZ | CHAN.GYRO_Y | CHAN.GYRO_Z;
  "we_wsen_itds_2533020201601": CHAN.ACCEL_X | CHAN.ACCEL_XYZ | CHAN.ACCEL_Y | CHAN.ACCEL_Z | CHAN.AMBIENT_TEMP;
  "we_wsen_pads_2511020213301": CHAN.AMBIENT_TEMP | CHAN.PRESS;
  "we_wsen_pdms_25131308XXX05": SensorChannelName;
  "we_wsen_pdus_25131308XXXXX": SensorChannelName;
  "we_wsen_tids_2521020222501": CHAN.AMBIENT_TEMP;
};

/**
 * Per-part bus kinds — types the Sensor constructor's bus-device argument:
 * an SPI-only part rejects I2C0.device(...) at the editor, a dual-bus part
 * accepts either. Keyed by the SENSOR token value, same pass as the data
 * record, so the two cannot drift.
 */
export type SensorBusOf = {
  "adi_ad2s1210": 'spi';
  "adi_ade7978": 'spi';
  "adi_adltc2990": 'i2c';
  "adi_adt7310": 'spi';
  "adi_adt7410": 'i2c';
  "adi_adt7420": 'i2c';
  "adi_adt7422": 'i2c';
  "adi_adxl345": 'i2c' | 'spi';
  "adi_adxl355": 'i2c' | 'spi';
  "adi_adxl362": 'spi';
  "adi_adxl366": 'i2c' | 'spi';
  "adi_adxl367": 'i2c' | 'spi';
  "adi_adxl372": 'i2c' | 'spi';
  "adi_max30210": 'i2c';
  "allegro_als31300": 'i2c';
  "amd_sb_tsi": 'i2c';
  "ams_as5048": 'spi';
  "ams_as5600": 'i2c';
  "ams_as6212": 'i2c';
  "ams_as6221": 'i2c';
  "ams_ccs811": 'i2c';
  "ams_ens210": 'i2c';
  "ams_iaqcore": 'i2c';
  "ams_tcs3400": 'i2c';
  "ams_tmd2620": 'i2c';
  "ams_tsl2540": 'i2c';
  "ams_tsl2561": 'i2c';
  "ams_tsl2591": 'i2c';
  "aosong_ags10": 'i2c';
  "aosong_aht20": 'i2c';
  "aosong_am2301b": 'i2c';
  "aosong_dht20": 'i2c';
  "asahi_kasei_ak8975": 'i2c';
  "asahi_kasei_akm09918c": 'i2c';
  "avago_apds9253": 'i2c';
  "avago_apds9306": 'i2c';
  "avago_apds9960": 'i2c';
  "avia_hx711_spi": 'spi';
  "bosch_bma280": 'i2c';
  "bosch_bma4xx": 'i2c' | 'spi';
  "bosch_bmc150_magn": 'i2c';
  "bosch_bme280": 'i2c' | 'spi';
  "bosch_bme680": 'i2c' | 'spi';
  "bosch_bmg160": 'i2c';
  "bosch_bmi08x_accel": 'i2c' | 'spi';
  "bosch_bmi08x_gyro": 'i2c' | 'spi';
  "bosch_bmi160": 'i2c' | 'spi';
  "bosch_bmi270": 'i2c' | 'spi';
  "bosch_bmi323": 'spi';
  "bosch_bmm150": 'i2c' | 'spi';
  "bosch_bmm350": 'i2c';
  "bosch_bmp180": 'i2c';
  "bosch_bmp388": 'i2c' | 'spi';
  "bosch_bmp390": 'i2c' | 'spi';
  "bosch_bmp581": 'i2c';
  "brcm_afbr_s50": 'spi';
  "fintek_f75303": 'i2c';
  "hamamatsu_s11059": 'i2c';
  "honeywell_hmc5883l": 'i2c';
  "honeywell_mpr": 'i2c';
  "hoperf_hp206c": 'i2c';
  "hoperf_th02": 'i2c';
  "infineon_dps310": 'i2c';
  "invensense_icm40627": 'i2c';
  "invensense_icm42370p": 'i2c' | 'spi';
  "invensense_icm42605": 'spi';
  "invensense_icm42670p": 'i2c' | 'spi';
  "invensense_icm42670s": 'i2c' | 'spi';
  "invensense_icm4268x": 'spi';
  "invensense_icm45605": 'i2c' | 'spi';
  "invensense_icm45605s": 'i2c' | 'spi';
  "invensense_icm45686": 'i2c' | 'spi';
  "invensense_icm45686s": 'i2c' | 'spi';
  "invensense_icm45688p": 'i2c' | 'spi';
  "invensense_icp101xx": 'i2c';
  "invensense_icp201xx": 'i2c' | 'spi';
  "invensense_mpu6050": 'i2c';
  "invensense_mpu9250": 'i2c';
  "isentek_ist8310": 'i2c';
  "isil_isl29035": 'i2c';
  "jedec_jc_42.4_temp": 'i2c';
  "liteon_ltr329": 'i2c';
  "liteon_ltr553": 'i2c';
  "liteon_ltrf216a": 'i2c';
  "lm75": 'i2c';
  "lm77": 'i2c';
  "maxbotix_mb7040": 'i2c';
  "maxim_max17055": 'i2c';
  "maxim_max17262": 'i2c';
  "maxim_max30101": 'i2c';
  "maxim_max31855": 'spi';
  "maxim_max31865": 'spi';
  "maxim_max31875": 'i2c';
  "maxim_max32664c": 'i2c';
  "maxim_max44009": 'i2c';
  "maxim_max6675": 'spi';
  "meas_ms5607": 'i2c' | 'spi';
  "meas_ms5837_02ba": 'i2c';
  "meas_ms5837_30ba": 'i2c';
  "melexis_mlx90394": 'i2c';
  "memsic_mc3419": 'i2c';
  "memsic_mmc56x3": 'i2c';
  "microchip_mcp9600": 'i2c';
  "microchip_tcn75a": 'i2c';
  "national_lm95234": 'i2c';
  "nxp_fxas21002": 'i2c' | 'spi';
  "nxp_fxls8974": 'i2c' | 'spi';
  "nxp_fxos8700": 'i2c' | 'spi';
  "nxp_p3t1755": 'i2c';
  "omron_2smpb_02e": 'i2c';
  "onnn_nct75": 'i2c';
  "panasonic_amg88xx": 'i2c';
  "phosense_xbr818": 'i2c';
  "pixart_paa3905": 'spi';
  "pixart_paj7620": 'i2c';
  "pixart_pat9136": 'spi';
  "pni_rm3100": 'i2c' | 'spi';
  "qst_qmi8658a": 'i2c';
  "renesas_hs300x": 'i2c';
  "renesas_hs400x": 'i2c';
  "rohm_bh1730": 'i2c';
  "rohm_bh1750": 'i2c';
  "rohm_bh1790": 'i2c';
  "sbs_sbs_gauge": 'i2c';
  "sciosense_ens160": 'i2c' | 'spi';
  "seeed_hm330x": 'i2c';
  "semtech_sx9500": 'i2c';
  "sensirion_scd40": 'i2c';
  "sensirion_scd41": 'i2c';
  "sensirion_sgp40": 'i2c';
  "sensirion_sht21": 'i2c';
  "sensirion_sht3xd": 'i2c';
  "sensirion_sht4x": 'i2c';
  "sensirion_shtcx": 'i2c';
  "sensirion_stcc4": 'i2c';
  "sensirion_sts4x": 'i2c';
  "silabs_si7055": 'i2c';
  "silabs_si7060": 'i2c';
  "silabs_si7210": 'i2c';
  "st_hts221": 'i2c' | 'spi';
  "st_i3g4250d": 'spi';
  "st_iis2dh": 'i2c' | 'spi';
  "st_iis2dlpc": 'i2c' | 'spi';
  "st_iis2iclx": 'i2c' | 'spi';
  "st_iis2mdc": 'i2c' | 'spi';
  "st_iis328dq": 'i2c' | 'spi';
  "st_iis3dhhc": 'spi';
  "st_iis3dwb": 'spi';
  "st_ilps22qs": 'i2c' | 'spi';
  "st_ism330dhcx": 'i2c' | 'spi';
  "st_ism6hg256x": 'i2c' | 'spi';
  "st_lis2de12": 'i2c' | 'spi';
  "st_lis2dh": 'i2c' | 'spi';
  "st_lis2dh12": 'i2c';
  "st_lis2ds12": 'i2c' | 'spi';
  "st_lis2du12": 'i2c' | 'spi';
  "st_lis2dux12": 'i2c' | 'spi';
  "st_lis2duxs12": 'i2c' | 'spi';
  "st_lis2dw12": 'i2c' | 'spi';
  "st_lis2mdl": 'i2c' | 'spi';
  "st_lis3dh": 'i2c';
  "st_lis3mdl_magn": 'i2c';
  "st_lps22df": 'i2c' | 'spi';
  "st_lps22hb_press": 'i2c';
  "st_lps22hh": 'i2c' | 'spi';
  "st_lps25hb_press": 'i2c';
  "st_lps28dfw": 'i2c';
  "st_lsm303agr_accel": 'i2c' | 'spi';
  "st_lsm303dlhc_accel": 'i2c';
  "st_lsm303dlhc_magn": 'i2c';
  "st_lsm6ds0": 'i2c';
  "st_lsm6dsl": 'i2c' | 'spi';
  "st_lsm6dso": 'i2c' | 'spi';
  "st_lsm6dso16is": 'i2c' | 'spi';
  "st_lsm6dso32": 'i2c' | 'spi';
  "st_lsm6dsv16x": 'i2c' | 'spi';
  "st_lsm6dsv320x": 'i2c' | 'spi';
  "st_lsm6dsv32x": 'i2c' | 'spi';
  "st_lsm6dsv80x": 'i2c' | 'spi';
  "st_lsm9ds0_gyro": 'i2c';
  "st_lsm9ds0_mfd": 'i2c';
  "st_lsm9ds1": 'i2c';
  "st_lsm9ds1_mag": 'i2c';
  "st_stts22h": 'i2c';
  "st_stts751": 'i2c';
  "st_vl53l0x": 'i2c';
  "st_vl53l1x": 'i2c';
  "ti_bq274xx": 'i2c';
  "ti_fdc2x1x": 'i2c';
  "ti_hdc": 'i2c';
  "ti_hdc302x": 'i2c';
  "ti_ina219": 'i2c';
  "ti_ina3221": 'i2c';
  "ti_ina7xx": 'i2c';
  "ti_tmag5170": 'spi';
  "ti_tmag5273": 'i2c';
  "ti_tmp007": 'i2c';
  "ti_tmp1075": 'i2c';
  "ti_tmp108": 'i2c';
  "ti_tmp112": 'i2c';
  "ti_tmp114": 'i2c';
  "ti_tmp11x": 'i2c';
  "ti_tmp435": 'i2c';
  "vishay_vcnl36825t": 'i2c';
  "vishay_vcnl4040": 'i2c';
  "vishay_veml6031": 'i2c';
  "vishay_veml6046": 'i2c';
  "vishay_veml7700": 'i2c';
  "we_wsen_hids_2525020210002": 'i2c';
  "we_wsen_isds_2536030320001": 'i2c' | 'spi';
  "we_wsen_itds_2533020201601": 'i2c' | 'spi';
  "we_wsen_pads_2511020213301": 'i2c' | 'spi';
  "we_wsen_pdms_25131308XXX05": 'i2c' | 'spi';
  "we_wsen_pdus_25131308XXXXX": 'i2c';
  "we_wsen_tids_2521020222501": 'i2c';
};
