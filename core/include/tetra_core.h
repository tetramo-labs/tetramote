#pragma once
#include <stddef.h>
#include <stdint.h>

// Strings returned by these functions are freed with tetra_string_free and
// event buffers with tetra_bytes_free. Handles are never 0.

char *tetra_generate_secret_key(void);
char *tetra_endpoint_id(const char *secret_key_hex);

uint64_t tetra_host_start(const char *config_json, char **error_out);
char *tetra_host_ticket(uint64_t host);
void tetra_host_set_trusted(uint64_t host, const char *ids_json);
void tetra_host_set_pairing_secret(uint64_t host, const char *secret);
int32_t tetra_host_send_control(uint64_t host, const char *json);
int32_t tetra_host_send_video(uint64_t host, uint64_t pts_us, uint8_t flags, const uint8_t *data, size_t len);
int32_t tetra_host_send_audio(uint64_t host, uint64_t pts_us, const uint8_t *data, size_t len);
uint32_t tetra_host_video_backlog(uint64_t host);
void tetra_host_disconnect_peer(uint64_t host);

uint64_t tetra_client_start(const char *config_json, char **error_out);
int32_t tetra_client_connect(uint64_t client, const char *request_json);
void tetra_client_disconnect(uint64_t client);
int32_t tetra_client_send_control(uint64_t client, const char *json);
int32_t tetra_client_send_input(uint64_t client, const uint8_t *data, size_t len);

uint8_t *tetra_next_event(uint64_t handle, uint32_t timeout_ms, size_t *len_out);
void tetra_stop(uint64_t handle);

void tetra_bytes_free(uint8_t *ptr, size_t len);
void tetra_string_free(char *s);
