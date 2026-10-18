// BlueBod CSI node — measures WiFi Channel State Information from your router and streams it to
// the BlueBod web app over Bluetooth LE (RuView ADR-018 binary frames) and USB serial (esp-csi
// CSI_DATA lines). Arduino-ESP32 core 3.x, ESP32 or ESP32-S3 (the C-series CSI config differs).
// Untested on hardware in this repository; see README "Firmware".
#include <WiFi.h>
#include <esp_wifi.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include "ping/ping_sock.h"
#include "lwip/ip_addr.h"

const char *WIFI_SSID = "your-2.4GHz-network";  // ESP32 CSI needs a 2.4 GHz network
const char *WIFI_PASS = "your-password";
const uint8_t NODE_ID = 1;                      // give each board its own number
#define SERVICE_UUID "b10eb0d0-0001-4c3a-9e5c-6b6f64790001"
#define CSI_UUID "b10eb0d0-0002-4c3a-9e5c-6b6f64790001"

struct Frame { int8_t rssi, noise; uint8_t mac[6]; uint8_t iq[128]; };
static QueueHandle_t frames;
static uint8_t routerMac[6];
static BLECharacteristic *csiChar;
static volatile bool bleConnected = false;
static uint32_t seq = 0;

// Runs in the WiFi task: copy the first 128 bytes (64-subcarrier LLTF, imaginary then real) and
// hand them to loop(). Only frames from the router are kept, so every packet measures one link.
static void onCsi(void *, wifi_csi_info_t *info) {
  if (!info || info->len < 128 || memcmp(info->mac, routerMac, 6) != 0) return;
  Frame f;
  f.rssi = info->rx_ctrl.rssi;
  f.noise = info->rx_ctrl.noise_floor;
  memcpy(f.mac, info->mac, 6);
  memcpy(f.iq, info->buf, 128);
  xQueueSend(frames, &f, 0);
}

class Connection : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { bleConnected = true; }
  void onDisconnect(BLEServer *server) override { bleConnected = false; server->startAdvertising(); }
};

// Ping the router 50 times a second so there is always a reply to measure.
static void startPing() {
  esp_ping_config_t config = ESP_PING_DEFAULT_CONFIG();
  ipaddr_aton(WiFi.gatewayIP().toString().c_str(), &config.target_addr);
  config.count = ESP_PING_COUNT_INFINITE;
  config.interval_ms = 20;
  config.timeout_ms = 1000;
  esp_ping_callbacks_t callbacks = {};
  esp_ping_handle_t ping;
  if (esp_ping_new_session(&config, &callbacks, &ping) == ESP_OK) esp_ping_start(ping);
}

void setup() {
  Serial.begin(921600);
  frames = xQueueCreate(16, sizeof(Frame));
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(200);
  memcpy(routerMac, WiFi.BSSID(), 6);

  wifi_csi_config_t csi = {};
  csi.lltf_en = true;
  csi.htltf_en = false;
  csi.stbc_htltf2_en = false;
  csi.ltf_merge_en = true;
  csi.channel_filter_en = false;
  csi.manu_scale = false;
  esp_wifi_set_csi_config(&csi);
  esp_wifi_set_csi_rx_cb(onCsi, nullptr);
  esp_wifi_set_csi(true);

  char name[20];
  snprintf(name, sizeof name, "BlueBod CSI %u", NODE_ID);
  BLEDevice::init(name);
  BLEDevice::setMTU(247);  // a 148-byte frame needs more than the default 23-byte MTU
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new Connection());
  BLEService *service = server->createService(SERVICE_UUID);
  csiChar = service->createCharacteristic(CSI_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  csiChar->addDescriptor(new BLE2902());
  service->start();
  BLEDevice::getAdvertising()->addServiceUUID(SERVICE_UUID);
  BLEDevice::startAdvertising();
  startPing();
}

void loop() {
  Frame f;
  if (xQueueReceive(frames, &f, pdMS_TO_TICKS(100)) != pdTRUE) return;
  seq++;

  // USB serial: esp-csi style line for BlueBod's "Connect USB board".
  Serial.printf("CSI_DATA,%lu,%02x:%02x:%02x:%02x:%02x:%02x,%d,0,%d,0,0,%d,0,0,0,128,0,\"[",
                (unsigned long)seq, f.mac[0], f.mac[1], f.mac[2], f.mac[3], f.mac[4], f.mac[5], f.rssi, f.noise, WiFi.channel());
  for (int i = 0; i < 128; i++) Serial.printf(i ? ",%d" : "%d", (int8_t)f.iq[i]);
  Serial.print("]\"\n");

  // Bluetooth: RuView ADR-018 frame, 20-byte little-endian header + 128 bytes of I/Q.
  if (!bleConnected) return;
  uint8_t b[148] = {0};
  uint32_t magic = 0xC5110001, freq = 2407 + 5 * WiFi.channel();
  uint16_t subcarriers = 64;
  memcpy(b, &magic, 4);
  b[4] = NODE_ID;
  b[5] = 1;
  memcpy(b + 6, &subcarriers, 2);
  memcpy(b + 8, &freq, 4);
  memcpy(b + 12, &seq, 4);
  b[16] = (uint8_t)f.rssi;
  b[17] = (uint8_t)f.noise;
  memcpy(b + 20, f.iq, 128);
  csiChar->setValue(b, sizeof b);
  csiChar->notify();
}
