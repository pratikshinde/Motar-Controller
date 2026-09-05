cmake_minimum_required(VERSION 3.10)

INCLUDE("${CMAKE_SOURCE_DIR}/config/Config_APP.cmake")

if (NOT DEFINED MODULE_LIST)
    INCLUDE("${KERNEL_DIR}/${SCMODULE}/KernelDefinitions.cmake")
endif()

if(EXISTS ${APP_DIR}/out/${SCMODULE}/old_fw_lib_list.cmake)
    INCLUDE(${APP_DIR}/out/${SCMODULE}/old_fw_lib_list.cmake)
endif()

if(EXISTS ${APP_DIR}/out/${SCMODULE}/old_fw_dflags.cmake)
    INCLUDE(${APP_DIR}/out/${SCMODULE}/old_fw_dflags.cmake)
endif()

SET(GCC_STDLIB_TARGET_PATH thumb/v7/nofp)
SET(GCC_VERSION 9.2.1)
SET(STDLIB
" \
    ${GCC_ARM_TOOLCHAIN_DIR}/arm-none-eabi/lib/${GCC_STDLIB_TARGET_PATH}/libm.a \
    ${GCC_ARM_TOOLCHAIN_DIR}/arm-none-eabi/lib/${GCC_STDLIB_TARGET_PATH}/libc.a \
    ${GCC_ARM_TOOLCHAIN_DIR}/arm-none-eabi/lib/${GCC_STDLIB_TARGET_PATH}/libstdc++.a \
    ${GCC_ARM_TOOLCHAIN_DIR}/arm-none-eabi/lib/${GCC_STDLIB_TARGET_PATH}/libg.a \
    ${GCC_ARM_TOOLCHAIN_DIR}/arm-none-eabi/lib/${GCC_STDLIB_TARGET_PATH}/libnosys.a \
    ${GCC_ARM_TOOLCHAIN_DIR}/lib/gcc/arm-none-eabi/${GCC_VERSION}/${GCC_STDLIB_TARGET_PATH}/libgcc.a"
)

#支持的编程语言配置
enable_language(ASM)

#项目名称
PROJECT(userspace)

# 项目配置
INCLUDE("${CMAKE_SOURCE_DIR}/config/buildOptions.cmake")
configure_file(
    "${PROJECT_SOURCE_DIR}/config/userspaceConfig.h.in"
    "${PROJECT_SOURCE_DIR}/config/userspaceConfig.h"
)

if(NOT DEFINED MODULE_LIST)

    # 预定义
    if(PROJECT_YSZNBG)
        ADD_DEFINITIONS(-DHOST_NAME="${SCMODULE}")
    endif(PROJECT_YSZNBG)

    if(PROJECT_TBDTU)
        ADD_DEFINITIONS(-DHOST_NAME="${SCMODULE}")
    endif(PROJECT_TBDTU)

    if(PROJECT_LYTBOX)
        ADD_DEFINITIONS(-DHOST_NAME="${SCMODULE}")
    endif(PROJECT_LYTBOX)

    if(DEFINED SDK_ADD_PRIV_PREMACRO)
        ADD_DEFINITIONS(${SDK_ADD_PRIV_PREMACRO})
    endif()

    if(DEFINED SDK_KERNEL_PREMACRO)
        ADD_DEFINITIONS(${SDK_KERNEL_PREMACRO})
    endif()

    if(DEFINED OLD_FW_DFLAGS)
        ADD_DEFINITIONS(${OLD_FW_DFLAGS})
    endif()

    if (EXISTS ${CMAKE_SOURCE_DIR}/sc_lib/${SCMODULE}/inc/scfw_socket_errno.h)
        ADD_DEFINITIONS(-DUSE_LWIP_ERRNO)
    endif()


    # 编译子目录
    if(NOT DEFINED SIMCOM_SDK)
        # 三方库源码，simcom本地总是编译生成lib，但不进行链接，在三方库链接控制中进行链接。并且，源码编译需要在target中添加依赖链，保证三方库源码先编译。
        if(HAS_FS)
            add_subdirectory(./public_libs/zlib zlib)
        endif(HAS_FS)
        add_subdirectory(./public_libs/miracl miracl)
        add_subdirectory(./public_libs/sm2 sm2)
        add_subdirectory(./public_libs/cjson cjson)

        if(DEFINED CQAPI)
            add_subdirectory(./sc_lib/CQAPI cq_lib)
        else()
            add_subdirectory(./sc_lib sc_lib)
            add_subdirectory(./sc_lib/V2 sc_lib_v2)
        endif()
    endif()

    if(HAS_DEMO)
        if(DEFINED CQAPI)
            add_subdirectory(./sc_demo/CQ cq_demo)
        else()
            if(CONFIG_SIMCOM_PROTOCOL_V1)
                add_subdirectory(./sc_demo/V1 sc_demo)
            elseif(CONFIG_SIMCOM_PROTOCOL_V2)
                add_subdirectory(./sc_demo/V2 sc_demo)
            endif()
        endif()
    endif(HAS_DEMO)

    if(PROJECT_YSZNBG)
        add_subdirectory(./application/ysznbg ysznbg)
    endif(PROJECT_YSZNBG)

    if(PROJECT_TBDTU)
        add_subdirectory(./application/topband topband)
    endif(PROJECT_TBDTU)

    if(PROJECT_LYTBOX)
        add_subdirectory(./application/lytbox lytbox)
    endif(PROJECT_LYTBOX)

    if(PROJECT_TOPFLY)
        add_subdirectory(./application/topfly topfly)
    endif(PROJECT_TOPFLY)

    # Swathi Switchgear MQTT bridge (this project's actual application —
    # the ysznbg/topband/lytbox/topfly blocks above are unused SIMCom
    # reference templates with no source present in this checkout). This
    # wiring — add_subdirectory here plus the target_link_libraries call
    # below — was missing from the committed CMakeLists.txt; the
    # application/swathi_mqtt/ source existed but was never actually
    # reachable from the build.
    add_subdirectory(./application/swathi_mqtt swathi_mqtt)

    # 外部库列表
    add_library(third_libs OBJECT IMPORTED GLOBAL)

    if(DEFINED OLD_FW_LIB_LIST)
        # 导入使用旧MAKE框架编译生成的lib
        set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
            ${OLD_FW_LIB_LIST}
        )
    endif()

    if(DEFINED THIRD_LIB)
    set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
        ${THIRD_LIB}
    )
    endif()

    # simcom本地或者release出去的SDK都需要的三方库链接控制
    if(HAS_ZLIB)
        set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
            "${CMAKE_SOURCE_DIR}/public_libs/lib/libzlib.a"
        )
    endif(HAS_ZLIB)

    if(HAS_MIRACL)
        set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
            "${CMAKE_SOURCE_DIR}/public_libs/lib/libmiracl.a"
        )
    endif(HAS_MIRACL)

    if(HAS_SM2)
        set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
            "${CMAKE_SOURCE_DIR}/public_libs/lib/libsm2.a"
        )
    endif(HAS_SM2)

    if(HAS_CJSON)
        set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
            "${CMAKE_SOURCE_DIR}/public_libs/lib/libcjson.a"
        )
    endif(HAS_CJSON)

    # release出去的SDK中三方库链接控制。
    if(DEFINED SIMCOM_SDK)
        if(DEFINED CQAPI)
            set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
                "${CMAKE_SOURCE_DIR}/sc_lib/CQAPI/${SCMODULE}/lib/libcq_lib.a"
            )
        else()
            set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
                "${CMAKE_SOURCE_DIR}/sc_lib/${SCMODULE}/lib/libsc_lib.a"
            )
            if(CONFIG_SIMCOM_PROTOCOL_V2)
                if(SIMCOM_DEBUG)
                    set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
                        "${CMAKE_SOURCE_DIR}/sc_lib/V2/lib/libsc_lib_v2_debug.a"
                    )
                else()
                    set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
                        "${CMAKE_SOURCE_DIR}/sc_lib/V2/lib/libsc_lib_v2.a"
                    )
                endif()
            endif()
        endif()
    endif(DEFINED SIMCOM_SDK)

    if(PROJECT_YSZNBG)
        set_property(TARGET third_libs APPEND PROPERTY IMPORTED_OBJECTS
        "${CMAKE_SOURCE_DIR}/third_libs/eziot-sdk/lib/libez_iot.a"
        "${CMAKE_SOURCE_DIR}/third_libs/eziot-sdk/lib/libez_linkcore.a"
        )
    endif(PROJECT_YSZNBG)

    # app源码及编译目标文件定义
    SET(app_src sc_application.c)

    if(DEFINED CQAPI)
        INCLUDE_DIRECTORIES(
            ./config
            ./sc_lib/CQAPI/inc
            ./sc_lib/CQAPI/${SCMODULE}/inc)
        if(DEFINED SIMCOM_SDK)
            INCLUDE_DIRECTORIES(
                ./sc_lib/CQAPI/inc
                ./sc_lib/CQAPI/inc/lwip
                ./sc_lib/CQAPI/inc/lwip/arch
                ./sc_lib/CQAPI/inc/lwip/ipv4
                ./sc_lib/CQAPI/inc/lwip/ipv6
                ./sc_lib/CQAPI/inc/lwip/lwip
                ./sc_lib/CQAPI/inc/lwip/netif
            )
        endif()
    else()
        INCLUDE_DIRECTORIES(
            ./config
            ./sc_lib/inc
            ./sc_lib/${SCMODULE}/inc
        )
    endif()

    if(CONFIG_SIMCOM_PROTOCOL_V2)
        INCLUDE_DIRECTORIES(
            ./sc_lib/V2/HAL
            ./sc_lib/V2/MAL
            ./sc_lib/V2/SAL
            ./sc_lib/V2/Pub
            ./sc_lib/V2/PL
        )
    endif()

    add_executable(userspace ${app_src} $<TARGET_OBJECTS:third_libs>)
    target_compile_options(userspace PUBLIC -Wall)
    set_target_properties(userspace PROPERTIES SUFFIX ".elf")
    set_target_properties(userspace PROPERTIES OUTPUT_NAME ${APP_NAME})

    # 连接目标配置
    if(DEFINED CQAPI)
        if(NOT DEFINED SIMCOM_SDK)
            target_link_libraries(userspace PRIVATE cq_lib)
        endif()
    else(DEFINED CQAPI)
        if(NOT DEFINED SIMCOM_SDK)
            target_link_libraries(userspace PRIVATE sc_lib)
            if(CONFIG_SIMCOM_PROTOCOL_V2)
                if(SIMCOM_DEBUG)
                    target_link_libraries(userspace PRIVATE sc_lib_v2_debug)
                else()
                    target_link_libraries(userspace PRIVATE sc_lib_v2)
                endif()
            endif()
        endif()
    endif(DEFINED CQAPI)

    if(HAS_DEMO)
        if(DEFINED CQAPI)
            target_link_libraries(userspace PRIVATE cq_demo)
        else(DEFINED CQAPI)
            target_link_libraries(userspace PRIVATE sc_demo)
        endif(DEFINED CQAPI)
    endif(HAS_DEMO)

    if(NOT DEFINED SIMCOM_SDK)
        if(HAS_FS)
            add_dependencies(userspace zlib miracl sm2 cjson)
        else()
            add_dependencies(userspace miracl sm2 cjson)
        endif(HAS_FS)
    endif(NOT DEFINED SIMCOM_SDK)

    if(PROJECT_YSZNBG)
        target_link_libraries(userspace PRIVATE ysznbg)
    endif(PROJECT_YSZNBG)

    if(PROJECT_TBDTU)
        target_link_libraries(userspace PRIVATE topband)
    endif(PROJECT_TBDTU)

    if(PROJECT_LYTBOX)
        target_link_libraries(userspace PRIVATE lytbox)
    endif(PROJECT_LYTBOX)

    if(PROJECT_TOPFLY)
        target_link_libraries(userspace PRIVATE topfly)
    endif(PROJECT_TOPFLY)

    target_link_libraries(userspace PRIVATE swathi_mqtt)

    # 设置连接脚本
    SET(LINK_SCRIP "${CMAKE_CURRENT_SOURCE_DIR}/config/${SCMODULE}_linkscript.ld")

    TARGET_LINK_OPTIONS(userspace PRIVATE
        -gc-sections -T${LINK_SCRIP}
        -NOSTDLIB ${SDK_ADD_PRIV_WRAPFLAGS}
    )

    # 连接参数配置
    SET(SDK_ADD_PRIV_WRAPFLAGS
        --wrap=fopen
        --wrap=fclose
        --wrap=fread
        --wrap=fwrite
        --wrap=mkdir
        --wrap=fseek
        --wrap=ftell
        --wrap=rewind
        --wrap=feof
    )


    # 库文件输出路径
    SET(LIBRARY_OUTPUT_PATH ${PROJECT_BINARY_DIR}/lib)

endif(NOT DEFINED MODULE_LIST)

# 自定义命令
# add_custom_command(
#     TARGET userspace
#     POST_BUILD
#     DEPENDS userspace
#     COMMAND ${OBJCPY}
#     ARGS -O binary ${CMAKE_BINARY_DIR}/${APP_NAME}.elf ${CMAKE_BINARY_DIR}/${APP_NAME}.bin
# )

if(NOT DEFINED SIMCOM_SDK)
# 安装SDK包
    SET(CMAKE_INSTALL_PREFIX ${PROJECT_SOURCE_DIR})  # default is /usr/local

    # install tools
    INSTALL(DIRECTORY ${TOOL_DIR}/linux ${TOOL_DIR}/win32
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}/tools
        PATTERN "*/cmake" EXCLUDE
        PATTERN "*/cross_tool" EXCLUDE
        PATTERN "*/msys64" EXCLUDE
        PATTERN "*/aboot" EXCLUDE
    )
    INSTALL(FILES ${TOOL_DIR}/win32/GNUmake.exe
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}
    )

    if(EXISTS ${ROOT_DIR}/AbootTool/arelease.exe)
        INSTALL(FILES ${ROOT_DIR}/AbootTool/arelease.exe
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/tools/win32/aboot
        )
        INSTALL(FILES ${TOOL_DIR}/linux/aboot/arelease ${TOOL_DIR}/linux/aboot/adownload
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/tools/linux/aboot
        )
    endif()

    INSTALL(FILES ${TOOL_DIR}/script/buildConfig.py ${TOOL_DIR}/script/env.mak ${TOOL_DIR}/script/make_image_16xx_settings.mak ${TOOL_DIR}/script/make_image_16xx.mak ${TOOL_DIR}/script/ble_tool.zip
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}/tools/script
    )

    # install make env
    INSTALL(FILES CMakeLists.txt makeDepend.mak old_fw_Makefile ${ROOT_DIR}/Makefile
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}
    )
    INSTALL(FILES config/buildOptions.cmake config/Config_APP.cmake config/ToolChain.cmake config/userspaceConfig.h.in config/Kconfig config/.config config/buildCusLib.mak config/image.mak config/package.mak config/ToolChain.mak
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}/config
    )
    if (EXISTS ${ROOT_DIR}/simcom/config/make_image_16xx.mak)
        INSTALL(FILES ${ROOT_DIR}/simcom/config/make_image_16xx_settings.mak ${ROOT_DIR}/simcom/config/make_image_16xx.mak
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/config
        )
    endif()
    if (EXISTS ${ROOT_DIR}/simcom_fw/config/make_image_18xx.mak)
        INSTALL(FILES ${ROOT_DIR}/simcom_fw/config/make_image_18xx.mak
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/config
        )
    endif()
    if (EXISTS ${ROOT_DIR}/simcom/config/make_image_18xx.mak)
        INSTALL(FILES ${ROOT_DIR}/simcom/config/make_image_18xx.mak
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/config
        )
    endif()

    # install cp images and config and link script
    if(DEFINED MODULE_LIST)
        string(REPLACE " " ";" TEM_LIST ${MODULE_LIST})
        foreach(one ${TEM_LIST})
            INSTALL(DIRECTORY ${KERNEL_DIR}/${one}
                DESTINATION ${ROOT_DIR}/release/${SCMODULE}/kernel
            )
            INSTALL(FILES config/${one}_linkscript.ld
                DESTINATION ${ROOT_DIR}/release/${SCMODULE}/config
            )
        endforeach()
    else(DEFINED MODULE_LIST)
        INSTALL(DIRECTORY ${KERNEL_DIR}/${SCMODULE}
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/kernel
        )
        INSTALL(FILES config/${SCMODULE}_linkscript.ld
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/config
        )
    endif(DEFINED MODULE_LIST)

    # install demo and api map lib
    if(DEFINED CQAPI)
        INSTALL(DIRECTORY sc_lib/CQAPI/inc
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/sc_lib/CQAPI
            PATTERN "*.gitignore*" EXCLUDE
        )
        if(DEFINED MODULE_LIST)
            string(REPLACE " " ";" TEM_LIST ${MODULE_LIST})
            foreach(one ${TEM_LIST})
                INSTALL(DIRECTORY sc_lib/CQAPI/${one}
                    DESTINATION ${ROOT_DIR}/release/${SCMODULE}/sc_lib/CQAPI
                    PATTERN "sc_lib/CQAPI/${one}/src" EXCLUDE
                    PATTERN "*.gitignore*" EXCLUDE
                )
            endforeach()
        else(DEFINED MODULE_LIST)
            INSTALL(DIRECTORY sc_lib/CQAPI/${SCMODULE}
                DESTINATION ${ROOT_DIR}/release/${SCMODULE}/sc_lib/CQAPI
                PATTERN "sc_lib/CQAPI/${SCMODULE}/src" EXCLUDE
                PATTERN "*.gitignore*" EXCLUDE
            )
        endif(DEFINED MODULE_LIST)
        INSTALL(DIRECTORY sc_demo/CQ
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/sc_demo
            PATTERN "*.gitignore*"  EXCLUDE
        )
    else(DEFINED CQAPI)
        # install api map
        INSTALL(DIRECTORY sc_lib/inc sc_lib/V2
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/sc_lib
            PATTERN "*.gitignore*" EXCLUDE
            PATTERN "sc_lib/V2/Doc" EXCLUDE
            PATTERN "*.c*" EXCLUDE
        )
        if(DEFINED MODULE_LIST)
            string(REPLACE " " ";" TEM_LIST ${MODULE_LIST})
            foreach(one ${TEM_LIST})
                INSTALL(DIRECTORY sc_lib/${one}
                    DESTINATION ${ROOT_DIR}/release/${SCMODULE}/sc_lib
                    PATTERN "sc_lib/${one}/src"  EXCLUDE
                    PATTERN "*.gitignore*"  EXCLUDE
                )
            endforeach()
        else(DEFINED MODULE_LIST)
            INSTALL(DIRECTORY sc_lib/${SCMODULE}
                DESTINATION ${ROOT_DIR}/release/${SCMODULE}/sc_lib
                PATTERN "sc_lib/${SCMODULE}/src"  EXCLUDE
                PATTERN "*.gitignore*"  EXCLUDE
            )
        endif(DEFINED MODULE_LIST)

        if(HAS_DEMO)
            # install demos
            INSTALL(DIRECTORY sc_demo
                DESTINATION ${ROOT_DIR}/release/${SCMODULE}
                PATTERN "sc_demo/CQ"  EXCLUDE
                PATTERN "*.gitignore*"  EXCLUDE
            )
        endif(HAS_DEMO)

        # install third libs
        INSTALL(DIRECTORY public_libs
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}
            PATTERN "*.c"  EXCLUDE
            PATTERN "*.txt"  EXCLUDE
        )
    endif(DEFINED CQAPI)

    # install userspace entry
    INSTALL(FILES sc_application.c
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}
    )

    # install custom resource
    if(PROJECT_YSZNBG)
        INSTALL(DIRECTORY third_libs/eziot-sdk third_libs/YS_V1.5.2
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}/third_libs
        )
        INSTALL(DIRECTORY application/ysznbg
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}/application
        )
    endif(PROJECT_YSZNBG)

    if(PROJECT_TBDTU)
        INSTALL(DIRECTORY application/topband
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}/application
        )
    endif(PROJECT_TBDTU)

    if(PROJECT_LYTBOX)
        INSTALL(DIRECTORY application/lytbox
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}/application
        )
    endif(PROJECT_LYTBOX)

    if(PROJECT_TOPFLY)
        INSTALL(DIRECTORY application/topfly
        DESTINATION ${ROOT_DIR}/release/${SCMODULE}/application
        )
        INSTALL(TARGETS sc_lib
            DESTINATION ${ROOT_DIR}/release/${SCMODULE}/application/topfly/lib
        )
    endif(PROJECT_TOPFLY)
endif(NOT DEFINED SIMCOM_SDK)
