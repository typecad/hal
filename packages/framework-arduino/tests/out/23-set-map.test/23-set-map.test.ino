#include <Arduino.h>

// Array methods using StaticArray
// Note: arr.push(x) → arr.push_back(x)
// Note: arr.pop() → arr.pop_back()
// Note: arr.length → arr.size()

// Polyfill: StaticArray for platforms without std::vector
template<typename T, size_t MaxSize = 32>
struct StaticArray {
    T data[MaxSize];
    size_t length = 0;
    
    void push_back(const T& value) {
        if (length < MaxSize) {
            data[length++] = value;
        }
    }
    
    T pop_back() {
        if (length > 0) {
            return data[--length];
        }
        return T();
    }
    
    T& operator[](size_t index) {
        return data[index];
    }
    
    const T& operator[](size_t index) const {
        return data[index];
    }
    
    size_t size() const { return length; }
    bool empty() const { return length == 0; }
    bool full() const { return length >= MaxSize; }
    
    T* begin() { return data; }
    T* end() { return data + length; }
    const T* begin() const { return data; }
    const T* end() const { return data + length; }
    
    void clear() { length = 0; }

    size_t indexOf(const T& value) const {
        for (size_t i = 0; i < length; i++) {
            if (data[i] == value) return i;
        }
        return (size_t)-1;
    }
};

#ifndef typecode_halt
#define typecode_halt(msg) do { Serial.println(F(msg)); for (;;) {} } while (0)
#endif

int __tc_fn1();
int __tc_fn2();
int __tc_fn3();
int __tc_fn4();
int __tc_fn5();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Data lookup patterns]");
  Serial.println("[TC:IT:array-based uniqueness check]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:parallel arrays for key-value lookup]");
  Serial.print("[TC:EXPECT:toBe:200:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:array overwrite value]");
  Serial.print("[TC:EXPECT:toBe:250:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:counting occurrences]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  uint8_t seen[] = { 42, 99, 0, 0 };
  int found = 0;
  for (int i = 0; i < 4; i++)
  {
    if (seen[i] == 42)
    {
      found = 1;
      break;
    }
  }
  return found;
}

int __tc_fn2()
{
  uint8_t seen[] = { 42, 99, 0, 0 };
  int found = 0;
  for (int i = 0; i < 4; i++)
  {
    if (seen[i] == 100)
    {
      found = 1;
      break;
    }
  }
  return found;
}

int __tc_fn3()
{
  int keys[] = { 10, 20, 30 };
  int vals[] = { 100, 200, 300 };
  int result = 0;
  for (int i = 0; i < 3; i++)
  {
    if (keys[i] == 20)
    {
      result = vals[i];
      break;
    }
  }
  return result;
}

int __tc_fn4()
{
  int keys[] = { 10, 20, 30 };
  int vals[] = { 100, 200, 300 };
  vals[1] = 250;
  int result = 0;
  for (int i = 0; i < 3; i++)
  {
    if (keys[i] == 20)
    {
      result = vals[i];
      break;
    }
  }
  return result;
}

int __tc_fn5()
{
  int data[] = { 5, 3, 5, 7, 5, 2 };
  int count = 0;
  for (int i = 0; i < (sizeof(data) / sizeof(data[0])); i++)
  {
    if (data[i] == 5)
    {
      count++;
    }
  }
  return count;
}

void loop()
{
}
