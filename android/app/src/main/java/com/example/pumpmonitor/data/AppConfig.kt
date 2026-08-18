package com.example.pumpmonitor.data

/**
 * ---------------------------------------------------------------
 *  EDIT THIS FILE for a real device or a deployed backend.
 * ---------------------------------------------------------------
 * Defaults target `backend/server.js` reachable from the Android emulator
 * via the emulator's host-loopback alias (10.0.2.2 -> the host machine's
 * localhost). Running on a physical device on the same network, replace
 * 10.0.2.2 with the host machine's LAN IP; for a deployed backend, use its
 * real hostname over HTTPS/WSS.
 */
object AppConfig {

    /** REST base URL. Must end with a trailing slash for Retrofit. */
    const val API_BASE_URL = "http://10.0.2.2:5000/api/v1/"

    /** WebSocket endpoint (FR-WEB-005). Token is appended as ?token=... at connect time. */
    const val WS_BASE_URL = "ws://10.0.2.2:5000/ws"
}
