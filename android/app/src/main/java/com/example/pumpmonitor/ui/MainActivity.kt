package com.example.pumpmonitor.ui

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.example.pumpmonitor.ui.alerts.AlertsScreen
import com.example.pumpmonitor.ui.dashboard.DashboardScreen
import com.example.pumpmonitor.ui.history.HistoryScreen
import com.example.pumpmonitor.ui.theme.Neon
import com.example.pumpmonitor.ui.theme.PumpTheme

private data class Tab(val route: String, val label: String, val icon: ImageVector)

class MainActivity : ComponentActivity() {

    private val notifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            PumpTheme {
                val nav = rememberNavController()
                val vm: PumpViewModel = viewModel()
                val tabs = listOf(
                    Tab("dashboard", "Monitor", Icons.Filled.Dashboard),
                    Tab("history", "History", Icons.Filled.History),
                    Tab("alerts", "Alerts", Icons.Filled.Notifications),
                )

                Scaffold(
                    containerColor = Neon.Background,
                    bottomBar = {
                        NavigationBar(containerColor = Neon.Card) {
                            val backStack by nav.currentBackStackEntryAsState()
                            val current = backStack?.destination?.route
                            tabs.forEach { tab ->
                                NavigationBarItem(
                                    selected = current == tab.route,
                                    onClick = {
                                        nav.navigate(tab.route) {
                                            popUpTo("dashboard"); launchSingleTop = true
                                        }
                                    },
                                    icon = { Icon(tab.icon, contentDescription = tab.label) },
                                    label = { Text(tab.label) },
                                )
                            }
                        }
                    },
                ) { padding ->
                    NavHost(
                        navController = nav,
                        startDestination = "dashboard",
                        modifier = Modifier.padding(padding),
                    ) {
                        composable("dashboard") { DashboardScreen(vm) }
                        composable("history") { HistoryScreen(vm) }
                        composable("alerts") { AlertsScreen(vm) }
                    }
                }
            }
        }
    }
}
