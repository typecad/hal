// ---------------------------------------------------------------------------
// __tc_rgbled.cpp — RgbLed shim implementation
// See __tc_rgbled.h for the contract. AUTOSAR C++14 compliant.
// ---------------------------------------------------------------------------

#include "__tc_rgbled.h"

namespace {

const std::int32_t kHexDigitCount = 6;
const std::uint32_t kHexBase = 16U;
const std::uint32_t kChannelMax = 255U;

std::uint8_t channel_scaled(std::uint8_t value, std::uint8_t scale)
{
  const std::uint32_t product = (static_cast<std::uint32_t>(value) * static_cast<std::uint32_t>(scale)) / kChannelMax;
  return static_cast<std::uint8_t>(product);
}

std::uint8_t hex_digit_value(char c)
{
  if ((c >= '0') && (c <= '9'))
  {
    return static_cast<std::uint8_t>(c - '0');
  }
  if ((c >= 'a') && (c <= 'f'))
  {
    return static_cast<std::uint8_t>((c - 'a') + 10);
  }
  if ((c >= 'A') && (c <= 'F'))
  {
    return static_cast<std::uint8_t>((c - 'A') + 10);
  }
  return kChannelMax + 1U;  // sentinel: not a hex digit
}

}  // namespace

const struct device* RgbLed::strip_device()
{
  return DEVICE_DT_GET(DT_ALIAS(led_strip));
}

RgbLed& RgbLed::color(std::uint8_t r, std::uint8_t g, std::uint8_t b)
{
  pixel_.r = r;
  pixel_.g = g;
  pixel_.b = b;
  return *this;
}

RgbLed& RgbLed::color(const char* hex)
{
  if (hex == nullptr)
  {
    return *this;
  }
  const char* p = hex;
  if (p[0] == '#')
  {
    p = &p[1];
  }
  std::uint32_t value = 0U;
  for (std::int32_t i = 0; i < kHexDigitCount; ++i)
  {
    const std::uint8_t digit = hex_digit_value(p[i]);
    if (digit > kChannelMax)
    {
      return *this;  // invalid input — ignored, buffered color untouched
    }
    value = (value * kHexBase) + static_cast<std::uint32_t>(digit);
  }
  pixel_.r = static_cast<std::uint8_t>((value >> 16) & 0xFFU);
  pixel_.g = static_cast<std::uint8_t>((value >> 8) & 0xFFU);
  pixel_.b = static_cast<std::uint8_t>(value & 0xFFU);
  return *this;
}

RgbLed& RgbLed::brightness(std::uint8_t scale)
{
  scale_ = scale;
  return *this;
}

RgbLed& RgbLed::show()
{
  struct led_rgb out{};
  out.r = channel_scaled(pixel_.r, scale_);
  out.g = channel_scaled(pixel_.g, scale_);
  out.b = channel_scaled(pixel_.b, scale_);
  static_cast<void>(led_strip_update_rgb(strip_device(), &out, 1U));
  return *this;
}

RgbLed& RgbLed::off()
{
  pixel_.r = 0U;
  pixel_.g = 0U;
  pixel_.b = 0U;
  return show();
}

RgbLed rgbLed;
