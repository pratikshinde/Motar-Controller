package com.agripump.smartspace.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.agripump.smartspace.ui.components.PhaseVoltageGauge
import com.agripump.smartspace.ui.components.PumpPowerSwitch

data class PumpDevice(
    val id: String,
    val name: String,
    val hpRating: String,
    val supplyType: String,
    var isRunning: Boolean,
    val isFault: Boolean,
    val latitude: Double,
    val longitude: Double
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen() {
    var selectedTab by remember { mutableStateOf(0) }
    val pumpsList = remember {
        mutableStateListOf(
            PumpDevice("PUMP-4G-3P-8821", "Borewell Pump #1", "15.0 HP", "3-phase", true, false, 19.9975, 73.7898),
            PumpDevice("PUMP-4G-3P-4412", "Canal Pump #2", "7.5 HP", "3-phase", false, true, 20.0050, 73.7620)
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "AgriPump SmartSpace",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Color.White
                        )
                        Text(
                            text = "API: Connected (http://localhost:5000)",
                            fontSize = 10.sp,
                            color = Color(0xFF10B981)
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF0F172A)
                )
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = Color(0xFF0F172A)
            ) {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    icon = { Icon(Icons.Default.Home, contentDescription = "Telemetry") },
                    label = { Text("Telemetry") }
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    icon = { Icon(Icons.Default.LocationOn, contentDescription = "Map") },
                    label = { Text("GIS Map") }
                )
                NavigationBarItem(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 },
                    icon = { Icon(Icons.Default.Build, contentDescription = "Devices") },
                    label = { Text("Devices") }
                )
                NavigationBarItem(
                    selected = selectedTab == 3,
                    onClick = { selectedTab = 3 },
                    icon = { Icon(Icons.Default.Settings, contentDescription = "Settings") },
                    label = { Text("Settings") }
                )
            }
        },
        containerColor = Color(0xFF070B14)
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp)
        ) {
            // 3-Phase Health Hero Box
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 16.dp),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A))
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "3-Phase Power Health Monitor",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    Text(
                        text = "● Phase Sequence: R-Y-B NORMAL",
                        fontSize = 11.sp,
                        color = Color(0xFF10B981)
                    )

                    Spacer(modifier = Modifier.height(14.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceAround
                    ) {
                        PhaseVoltageGauge(phaseLabel = "Phase R-Y", voltage = 418f)
                        PhaseVoltageGauge(phaseLabel = "Phase Y-B", voltage = 422f)
                        PhaseVoltageGauge(phaseLabel = "Phase B-R", voltage = 415f)
                    }
                }
            }

            Text(
                text = "My Pump Fleet",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                modifier = Modifier.padding(bottom = 10.dp)
            )

            // Pump Cards List
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(pumpsList) { pump ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(
                                width = 1.dp,
                                color = if (pump.isFault) Color(0xFFF43F5E) else Color(0xFF1E293B),
                                shape = RoundedCornerShape(16.dp)
                            ),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A))
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(
                                        text = "${pump.name} (${pump.hpRating})",
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White
                                    )
                                    Text(
                                        text = "${pump.supplyType} • ID: ${pump.id}",
                                        fontSize = 11.sp,
                                        color = Color(0xFF94A3B8)
                                    )
                                }

                                Surface(
                                    shape = RoundedCornerShape(999.dp),
                                    color = if (pump.isFault) Color(0x33F43F5E) else (if (pump.isRunning) Color(0x3310B981) else Color(0x3394A3B8))
                                ) {
                                    Text(
                                        text = if (pump.isFault) "FAULT" else (if (pump.isRunning) "RUNNING" else "STOPPED"),
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        color = if (pump.isFault) Color(0xFFF43F5E) else (if (pump.isRunning) Color(0xFF10B981) else Color(0xFF94A3B8)),
                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(10.dp))

                            Text(
                                text = "📍 GPS: ${pump.latitude}° N, ${pump.longitude}° E",
                                fontSize = 11.sp,
                                color = Color(0xFF38BDF8)
                            )

                            Spacer(modifier = Modifier.height(10.dp))

                            PumpPowerSwitch(
                                pumpId = pump.id,
                                isRunning = pump.isRunning,
                                onToggle = { newState ->
                                    pump.isRunning = newState
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
