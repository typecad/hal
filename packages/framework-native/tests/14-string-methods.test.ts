import { describe, done } from '@typecad/expect';

describe("String methods")
  .it("toUpperCase")
  .expectString(
    (() => {
      const cmd = "at+connect";
      return cmd.toUpperCase();
    })
  ).toBe("AT+CONNECT")
  .it("toLowerCase")
  .expectString(
    (() => {
      const cmd = "STATUS OK";
      return cmd.toLowerCase();
    })
  ).toBe("status ok")
  .it("includes substring")
  .expect(
    (() => {
      const response = "OK CONNECTED";
      return response.includes("OK") ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      const response = "ERROR";
      return response.includes("OK") ? 1 : 0;
    })
  ).toBe(0)
  .it("startsWith")
  .expect(
    (() => {
      const nmea = "$GPRMC,123519,A,4807.038,N,01131.000,E";
      return nmea.startsWith("$GPRMC") ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      const nmea = "$GPGGA,123519,4807.038,N";
      return nmea.startsWith("$GPRMC") ? 1 : 0;
    })
  ).toBe(0)
  .it("endsWith")
  .expect(
    (() => {
      const frame = "DATA!";
      return frame.endsWith("!") ? 1 : 0;
    })
  ).toBe(1)
  .expect(
    (() => {
      const frame = "DATA";
      return frame.endsWith("!") ? 1 : 0;
    })
  ).toBe(0)
  .it("trim")
  .expectString(
    (() => {
      const raw = "  sensor-42  ";
      return raw.trim();
    })
  ).toBe("sensor-42")
  .it("substring")
  .expectString(
    (() => {
      const frame = "$GPRMC,123519,A";
      return frame.substring(0, 6);
    })
  ).toBe("$GPRMC")
  .expectString(
    (() => {
      const frame = "$GPRMC,123519,A";
      return frame.substring(7);
    })
  ).toBe("123519,A")
  .it("slice")
  .expectString(
    (() => {
      const data = "Hello,World";
      return data.slice(0, 5);
    })
  ).toBe("Hello")
  .expectString(
    (() => {
      const data = "Hello,World";
      return data.slice(6);
    })
  ).toBe("World")
  .it("indexOf")
  .expect(
    (() => {
      const csv = "temp-25,hum-60";
      return csv.indexOf(",");
    })
  ).toBe(7)
  .expect(
    (() => {
      const csv = "temp-25,hum-60";
      return csv.indexOf("-");
    })
  ).toBe(4)
  .it("replace")
  .expectString(
    (() => {
      const cmd = "SET BAUD 9600";
      return cmd.replace("9600", "115200");
    })
  ).toBe("SET BAUD 115200")
  .it("charCodeAt")
  .expect(
    (() => {
      const ch = "A";
      return ch.charCodeAt(0);
    })
  ).toBe(65)
  .expect(
    (() => {
      const ch = "0";
      return ch.charCodeAt(0);
    })
  ).toBe(48)

done();
