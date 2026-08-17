INCLUDE_DIRECTORIES(./inc)
add_library(swathi_mqtt STATIC ./src/mqtt_bridge.c)
target_include_directories(swathi_mqtt PRIVATE 
    ${CMAKE_SOURCE_DIR}/sc_lib/inc 
    ${CMAKE_SOURCE_DIR}/sc_lib/${SCMODULE}/inc 
    ${CMAKE_SOURCE_DIR}/config)
