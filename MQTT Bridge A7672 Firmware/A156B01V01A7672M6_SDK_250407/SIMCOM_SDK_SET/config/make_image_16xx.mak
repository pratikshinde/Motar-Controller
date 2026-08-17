#############################
#  create aboot package
############################

include ${TOOL_DIR}/script/env.mak
include make_image_16xx_settings.mak


ifneq (,$(SIMCOM_RELEASE_SDK))
ABOOT_DIR := $(TOOL_DIR)/$(PLATFORM)/aboot
else
ABOOT_DIR := ${ROOT_DIR}/AbootTool
endif
ARELEASE := $(ABOOT_DIR)/arelease
ARELEASE := $(subst $(BAD_SLASH),$(GOOD_SLASH),$(ARELEASE))

OUT ?= out

SC_USR_OPT_LIST := $(subst _, ,${SC_USR_OPT})
SC_HD_OPT_LIST := $(subst _, ,${SC_HD_OPT})



OUT_DIR := ${ROOT_DIR}/${OUT}/${SC_MODULE_FULL}
ifeq (TRUE,${FACTORY})
ABOOT_OUT_DIR := ${OUT_DIR}/aboot_factory
else
ABOOT_OUT_DIR := ${OUT_DIR}/aboot
endif
ABOOT_IMAGES_OUT_DIR := ${ABOOT_OUT_DIR}/images

##########################################
#     KERNEL OUTPUT PATH
########################################
KERNEL_SRC_NAME ?= cp.bin
APN_SRC_NAME ?=apn.bin
ifneq (,$(findstring OPENSDK,${SC_MODULE_BASE}))
KERNEL_SRC_PATH := ${KERNEL_DIR}/${SC_MODULE_FULL}
else
KERNEL_SRC_PATH := ${ROOT_DIR}/tavor/Arbel/bin
endif

ifneq (,$(findstring OPENSDK,${SC_MODULE_BASE}))
##########################################
#     USERSPACE OUTPUT PATH
########################################
USERSPACE_SRC_NAME := ${APP_NAME}.bin
USERSPACE_SRC_PATH := ${APP_DIR}/${OUT}/${SC_MODULE_FULL}
endif

##########################################
#     aboot config PATH
########################################
ifneq (,${SIMCOM_RELEASE_SDK})

ifeq (TRUE,${FACTORY})
ABOOT_SRC_NAME := aboot_factory
else
ABOOT_SRC_NAME := aboot
endif
ABOOT_SRC_PATH := ${KERNEL_DIR}/${SC_MODULE_FULL}

else  # ifneq (,${SIMCOM_RELEASE_SDK})

ifneq (,$(findstring _1606_,_${SC_MODULE_BASE}_))
ABOOT_CFG := releasepack-ASR1606-source
ASR_MODEL := CRANEL
PREBOOT_NAME := 2021.10.16
ASR_BOOT33 := build_bootloader_craneL_singlesim
else ifneq (,$(findstring _1602_,_${SC_MODULE_BASE}_))
ABOOT_CFG := releasepack-ASR1602-source
ASR_MODEL := CRANELR
PREBOOT_NAME := 2022.11.06
ASR_BOOT33 := build_bootloader_craneL_singlesim
else ifneq (,$(findstring _1603_,_${SC_MODULE_BASE}_))
ABOOT_CFG := releasepack-ASR1603-source
ASR_MODEL := CRANEM
PREBOOT_NAME := 2020.07.30
ASR_BOOT33 := build_bootloader
else ifneq (,$(findstring _1601_,_${SC_MODULE_BASE}_))
ABOOT_CFG := releasepack-ASR1601-source
ASR_MODEL := CRANE
ASR_BOOT33 := build_bootloader
else ifneq (,$(findstring _1607_,_${SC_MODULE_BASE}_))
ABOOT_CFG := releasepack-ASR1607-source
ASR_MODEL := CRANELG
PREBOOT_NAME := 2022.11.06
ASR_BOOT33 := build_bootloader_craneL_singlesim
else ifneq (,$(findstring _1605_,_${SC_MODULE_BASE}_))
ABOOT_CFG := releasepack-ASR1605-source
ASR_MODEL := CRANELRH
PREBOOT_NAME := 2022.11.06
ASR_BOOT33 := build_bootloader_craneL_singlesim
endif


##########################################
#     aboot config PATH
########################################
ABOOT_CONFIG_SRC_NAME := config
ABOOT_CONFIG_SRC_PATH := ${ROOT_DIR}/AbootTool/configurations/${ABOOT_CFG}

ABOOT_IMAGES_SRC_NAME := images
ABOOT_IMAGES_SRC_PATH := ${ROOT_DIR}/AbootTool/configurations/${ABOOT_CFG}

PREBOOT_BIN       := preboot.bin
PREBOOT_CUST_NAME := n

ifneq (,$(findstring _A7680C_LNNV_1602_V801_OPENSDK_HIK_ENORLFSV2_,_$(SC_MODULE_FULL)_))
PREBOOT_CUST_NAME := 2022.11.06_CUS_HIK
else ifneq (,$(findstring _A7680C_LNNV_1602_V801_OPENSDK_TTS_ENORLFSV2_BSJ_,_$(SC_MODULE_FULL)_))
PREBOOT_CUST_NAME := 2022.11.06_CUS_BSJ
else ifneq (,$(findstring _A7682S_LNXV_1602_V801_OPENSDK_VSGS_AUDIO_,_$(SC_MODULE_FULL)_))
PREBOOT_CUST_NAME := 2022.11.06_CUS_VSGS
else ifneq (,$(findstring _A7680C_MANS_1606_V603_OPENSDK_PGWL_,_$(SC_MODULE_FULL)_))
PREBOOT_CUST_NAME := 2021.10.16_CUS_PGWL
else ifneq (,$(findstring _A7672E_FASE_1603_V101_DS_OPENSDK_RU_,_$(SC_MODULE_FULL)_)$(findstring _A7672E_FASE_1603_V201_DS_OPENSDK_RU_,_$(SC_MODULE_FULL)_)$(findstring _A7672SA_FASE_1603_V101_DS_OPENSDK_RU_,_$(SC_MODULE_FULL)_))
PREBOOT_CUST_NAME := 2020.07.30_CUS_RU
else ifneq (,$(findstring _OAKTER_,_$(SC_USR_OPT)_))
PREBOOT_CUST_NAME := 2022.11.06_CUS_OAKTER
endif

##########################################
#     NVM PATH
########################################
NVM_PLATFORM := NULL
ifneq (,$(findstring UCVSIM,${SC_USR_OPT}))
	NVM_PLATFORM := UCVSIM
endif

ifneq (,$(findstring ONOMONDO,${SC_USR_OPT}))
	NVM_PLATFORM := ONOMONDO
endif

ifeq (,$(findstring _A7672E_FASE_1603_V201_,_$(SC_MODULE_FULL)_))
	ifneq (,$(findstring _RU_,_${SC_USR_OPT}_))
		NVM_PLATFORM := RU
	endif
endif

ifneq (,$(findstring _A7680C_LANS_1606_V506_CQCY_,_$(SC_MODULE_FULL)_))
	NVM_PLATFORM := CQCY
endif

NVM_OUT_NAME := nvm.bin
NVM_SRC_PATH := ${PREBUILD_DIR}/NVM/${NVM_PLATFORM}

ifeq (NULL,${NVM_PLATFORM})
NVM_SRC_NAME := 0KiB.bin
else
NVM_SRC_NAME := $(shell python getInfo.py GET_NVM_SIZE ${ABOOT_CONFIG_SRC_PATH}/${ABOOT_SRC_NAME}/config/product/${ASR_PRODUCT_TYPE}.json ${ASR_PRODUCT}).bin
endif

##########################################
#     FOTA_PARAM PATH
########################################
ifneq (,$(SC_HD_CFG))
ifneq (,$(findstring OPENSDK,${SC_MODULE_BASE}))
FOTA_PARAM_OUT_NAME := FOTA_PARAM.bin
	ifeq (TRUE,${FACTORY})
	FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}/FACTORY
	else
	FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}
	endif

	##A1603
	ifneq (,$(findstring _1603_,_${SC_MODULE_BASE}_))
		ifeq (SINGLESIM,$(patsubst %A,SINGLESIM,$(SC_HD_CFG)))
			ifeq (TRUE,${FACTORY})
			FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}/SingleSIM/FACTORY
			else
			FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}/SingleSIM
			endif
		else
			ifeq (TRUE,${FACTORY})
			FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}/NonSingleSIM/FACTORY
			else
			FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}/NonSingleSIM
			endif
		endif
	endif
endif
endif

ifneq (,$(SC_HD_CFG))
ifneq (,$(findstring UBIA,${SC_USR_OPT}))
FOTA_PARAM_OUT_NAME := FOTA_PARAM.bin
ifeq (TRUE,${FACTORY})
FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}/FACTORY
else
FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}
endif
endif
endif

ifneq (,$(SC_HD_CFG))
ifneq (,$(findstring UBLOX,${SC_USR_OPT}))
FOTA_PARAM_OUT_NAME := FOTA_PARAM.bin
ifeq (TRUE,${FACTORY})
FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}/FACTORY
else
FOTA_PARAM_SRC_PATH := ${PREBUILD_DIR}/FOTA_PARAM/${ASR_MODEL}
endif
endif
endif

##########################################
#     GPS PATH
########################################
ifneq (,$(findstring _UC6228_,_${GPS_FIRM}_))
	GPS_OUT_NAME1 := gps_bootloader.bin
	GPS_OUT_NAME2 := gps_firmware.bin
	ifneq (,$(findstring _DOMESTIC_,_$(MODULE_TARGET_TYPE)_))
		GPS_PRESET := domestic
	else
		GPS_PRESET := foreign
	endif
	ifneq (,$(findstring _ADSUN_,_${SC_USR_OPT}_)$(findstring _BINHANH_,_${SC_USR_OPT}_)$(findstring _3SCORP_,_${SC_USR_OPT}_))	#special GNSS firmware for customer
		GPS_PRESET := customer/BINHANH
	endif
	GPS_SRC_PATH := ${PREBUILD_DIR}/GPS/UC6228/${GPS_PRESET}
else ifneq (,$(findstring _ASR5311_,_${GPS_FIRM}_))
	GPS_OUT_NAME := jacana_fw.bin
	ifneq (,$(findstring _1607_,_${SC_MODULE_BASE}_))
		GPS_SRC_PATH := ${PREBUILD_DIR}/GPS/ASR1607_GNSS
	else
		GPS_SRC_PATH := ${PREBUILD_DIR}/GPS/ASR5311_GNSS
	endif
else ifneq (,$(findstring _CC1161W_,_${GPS_FIRM}_))
	GPS_OUT_NAME1 := gps_bootloader.bin
	GPS_OUT_NAME2 := gps_firmware.bin
	GPS_SRC_PATH := ${PREBUILD_DIR}/GPS/CC1161W
else ifneq (,$(findstring _CC1177W_,_${GPS_FIRM}_))
	GPS_OUT_NAME1 := gps_bootloader.bin
	GPS_OUT_NAME2 := gps_firmware.bin
	GPS_SRC_PATH := ${PREBUILD_DIR}/GPS/CC1177W
endif
##########################################
#     DSP PATH
########################################
DSP_SRC_NAME := dsp.bin
ifneq (,$(findstring _1602_,_${SC_MODULE_BASE}_))
ifeq (4M,$(patsubst %V,4M,$(SC_HD_CFG)))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_WiFiScan_Reduce_SuLog_Buffer
## special
ifneq (,$(findstring _A7682S_LNXV_1602_V801_OPENSDK_,_${SC_MODULE_FULL}_))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Reduce_SuLog
endif

else
ifneq (,$(findstring _WIFISCAN_,_${SC_USR_OPT}_))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_WiFiScan_Reduce_SuLog_Buffer
else ifneq (,$(findstring _CSSMS_,_${SC_USR_OPT}_)$(findstring _A7670G_MNMY_1602_UB_V101_,_${SC_MODULE_BASE}_)$(findstring _A7670NA_MNMY_1602_UB_V101_,_$(SC_MODULE_BASE)_)$(findstring _A7670NA_LNMY_1602_UB_V101_,_$(SC_MODULE_BASE)_)$(findstring _A7670G_LNMY_1602_UB_V101_,_${SC_MODULE_BASE}_))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Reduce_SuLog_Buffer
else
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Reduce_SuLog_Buffer
endif
endif
else ifneq (,$(findstring _1606_,_${SC_MODULE_BASE}_))
ifneq (,$(findstring _DS_,_${SC_MODULE_BASE}_))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Normal
else
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Reduce_SuLog
endif
ifeq (2M,$(patsubst %Y,2M,$(SC_HD_CFG)))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Reduce_SuLog_Buffer
endif
ifeq (4M,$(patsubst %V,4M,$(SC_HD_CFG)))
ifneq (,$(findstring _VOLTE_,_${SC_USR_OPT}_))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Reduce_SuLog_Buffer
endif
endif
ifneq (,$(findstring _A7677S_LANV_1606_V702_OPENSDK_,_${SC_MODULE_BASE}_))
ifneq (,$(findstring _WALNUT_,_${SC_USR_OPT}_))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Reduce_SuLog_Buffer
endif
endif
else ifneq (,$(findstring _1603_,_${SC_MODULE_BASE}_))
## 1603
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/CAT1GSM
ifeq (SINGLESIM,$(patsubst %A,SINGLESIM,$(SC_HD_CFG)))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/CAT1GSM_Reduce_SuLog_Buffer
endif
ifneq (,$(findstring _LTEONLY_,_${SC_MODULE_BASE}_))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/CAT1ONLY
endif

else ifneq (,$(findstring _1607_,_${SC_MODULE_BASE}_))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Reduce_SuLog_Buffer
else ifneq (,$(findstring _1605_,_${SC_MODULE_BASE}_))
DSP_SRC_PATH := ${PREBUILD_DIR}/DSP/${ASR_MODEL}/DSP_Reduce_SuLog_Buffer
endif

define dsp_usr_opt_process
ifeq ($(1),$(notdir $(wildcard ${DSP_SRC_PATH}/$(1))))
DSP_SRC_PATH := ${DSP_SRC_PATH}/$(1)
endif
endef
ifeq (${SC_MODULE_BASE}${SC_USR_OPT},$(notdir $(wildcard ${DSP_SRC_PATH}/${SC_MODULE_BASE}${SC_USR_OPT})))
DSP_SRC_PATH := ${DSP_SRC_PATH}/${SC_MODULE_BASE}${SC_USR_OPT}
else
$(foreach opt,${SC_HD_OPT_LIST},$(eval $(call dsp_usr_opt_process,${opt})))
$(foreach opt,${SC_USR_OPT_LIST},$(eval $(call dsp_usr_opt_process,${opt})))
endif

ifeq (path.txt,$(notdir $(wildcard ${DSP_SRC_PATH}/path.txt)))
DSP_SRC_PATH := ${PREBUILD_DIR}/$(shell ${CAT} $(subst ${BAD_SLASH},${GOOD_SLASH},${DSP_SRC_PATH}/path.txt))
endif


##########################################
#     BT PATH
########################################
BT_SRC_NAME1 := btbin.bin
BT_SRC_NAME2 := btlst.bin
BT_SRC_PATH := ${PREBUILD_DIR}/BT

ifeq (path.txt,$(notdir $(wildcard ${BT_SRC_PATH}/path.txt)))
BT_SRC_PATH := ${PREBUILD_DIR}/$(shell ${CAT} $(subst ${BAD_SLASH},${GOOD_SLASH},${BT_SRC_PATH}/path.txt))
endif


##########################################
#     boot33 PATH
########################################
BOOT33_SRC_NAME := boot33.bin
BOOT33_SRC_PATH := ${PREBUILD_DIR}/boot33/${ASR_BOOT33}
ifneq (,$(findstring _1603_,_${SC_MODULE_BASE}_))
ifeq (SINGLESIM,$(patsubst %A,SINGLESIM,$(SC_HD_CFG)))
BOOT33_SRC_PATH := ${PREBUILD_DIR}/boot33/build_bootloader_craneM_Thin
endif
endif

ifneq (,$(findstring _1602_,_${SC_MODULE_BASE}_))
ifneq (,$(findstring _FULLFOTA_,_$(SC_USR_OPT)_))
BOOT33_SRC_PATH := ${PREBUILD_DIR}/boot33/build_bootloader_craneL_singlesim_fullfota
endif
endif

ifneq (,$(findstring _1606_,_${SC_MODULE_BASE}_))
ifneq (,$(findstring _DS_,_${SC_MODULE_BASE}_))
BOOT33_SRC_PATH := ${PREBUILD_DIR}/boot33/build_bootloader_craneL
endif
endif

define boot33_usr_opt_process
ifeq ($(1),$(notdir $(wildcard ${BOOT33_SRC_PATH}/$(1))))
BOOT33_SRC_PATH := ${BOOT33_SRC_PATH}/$(1)
endif
endef

ifeq (${SC_MODULE_BASE}${SC_USR_OPT},$(notdir $(wildcard ${BOOT33_SRC_PATH}/${SC_MODULE_BASE}${SC_USR_OPT})))
BOOT33_SRC_PATH := ${BOOT33_SRC_PATH}/${SC_MODULE_BASE}${SC_USR_OPT}
else
$(foreach opt,${SC_HD_OPT_LIST},$(eval $(call boot33_usr_opt_process,${opt})))
$(foreach opt,${SC_USR_OPT_LIST},$(eval $(call boot33_usr_opt_process,${opt})))
endif

ifeq (path.txt,$(notdir $(wildcard ${BOOT33_SRC_PATH}/path.txt)))
BOOT33_SRC_PATH := ${PREBUILD_DIR}/$(shell ${CAT} $(subst ${BAD_SLASH},${GOOD_SLASH},${BOOT33_SRC_PATH}/path.txt))
endif


##########################################
#     updater PATH
########################################
UPDATER_SRC_NAME := updater.bin

#1606
ifneq (,$(findstring _1606_,_${SC_MODULE_BASE}_))
#1606 DS
	ifneq (,$(findstring _DS_,_${SC_MODULE_BASE}_))
		UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL/UART2
		ifneq (,$(findstring A7680C,${SC_MODULE}))
			ifneq (,$(findstring _V506,_$(SC_HD_OPT)_)$(findstring _V503,_$(SC_HD_OPT)_)$(findstring _V603,_$(SC_HD_OPT)_)$(findstring _V602_,_$(SC_HD_OPT)_))
				UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL/UART4
			endif
		else ifneq (,$(findstring A7670C,${SC_MODULE}))
			ifneq (,$(findstring _V701,_$(SC_HD_OPT)_)$(findstring _V702,_$(SC_HD_OPT)_)$(findstring _V703,_$(SC_HD_OPT)_))
				UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL/UART4
			endif
		else ifneq (,$(findstring A7677S,${SC_MODULE}))
			ifneq (,$(findstring _V702,_$(SC_HD_OPT)_)$(findstring _V703,_$(SC_HD_OPT)_))
				UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL/UART4
			endif
		else ifneq (,$(findstring A7683E,${SC_MODULE}))
			ifneq (,$(findstring _V102,_$(SC_HD_OPT)_)$(findstring _V103,_$(SC_HD_OPT)_))
				UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL/UART4
			endif
		endif
#1606 SINGLESIM
	else
		UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL_NoUpdt/UART2
		ifneq (,$(findstring A7680C,${SC_MODULE}))
			ifneq (,$(findstring _V506,_$(SC_HD_OPT)_)$(findstring _V503,_$(SC_HD_OPT)_)$(findstring _V603,_$(SC_HD_OPT)_)$(findstring _V602_,_$(SC_HD_OPT)_))
				UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL_NoUpdt/UART4
			endif
		else ifneq (,$(findstring A7670C,${SC_MODULE}))
			ifneq (,$(findstring _V701,_$(SC_HD_OPT)_)$(findstring _V702,_$(SC_HD_OPT)_)$(findstring _V703,_$(SC_HD_OPT)_))
				ifneq (,$(findstring _UBLOX_,_$(SC_MODULE_FULL)_))
					UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL_NoUpdt_UBLOX
				else
					UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL_NoUpdt/UART4
				endif
			endif
		else ifneq (,$(findstring A7677S,${SC_MODULE}))
			ifneq (,$(findstring _V702,_$(SC_HD_OPT)_)$(findstring _V703,_$(SC_HD_OPT)_))
				UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL_NoUpdt/UART4
			endif
		endif
	endif
#1603
else ifneq (,$(findstring _1603_,_${SC_MODULE_BASE}_))
	UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd
#1603C
	ifeq (TRUE,$(patsubst %A,TRUE,$(SC_HD_CFG)))
        ifneq (,$(findstring _CSWS_EXTWDG_,_$(SC_MODULE_FULL)_))
            UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneM_NoUpdt_CSWS_EXTWDG
        else
            UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneM_NoUpdt
        endif
#1603S
	else ifneq (,$(findstring _EXTWDG_,_$(SC_USR_OPT)_)$(findstring _PMDTU_,_$(SC_USR_OPT)_))
		ifneq (,$(findstring _CSWS_,_$(SC_MODULE_FULL)_))
            UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd/ext_wdg/CSWS
        else
			UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd/ext_wdg
		endif
	endif
#1602&1605&1607
else
	UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL_NoUpdt/UART2
	ifneq (,$(findstring _FULLFOTA_,_$(SC_USR_OPT)_))
		UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL_fullfota_extnor
	else ifneq (,$(findstring _YAXON_,_$(SC_USR_OPT)_))
		UPDATER_SRC_PATH := ${PREBUILD_DIR}/updater/build_updater_no_lcd_craneL_NoUpdt/YAXON
	endif
endif

define updater_usr_opt_process
ifeq ($(1),$(notdir $(wildcard ${UPDATER_SRC_PATH}/$(1))))
UPDATER_SRC_PATH := ${UPDATER_SRC_PATH}/$(1)
endif
endef
ifeq (${SC_MODULE_BASE}${SC_USR_OPT},$(notdir $(wildcard ${UPDATER_SRC_PATH}/${SC_MODULE_BASE}${SC_USR_OPT})))
UPDATER_SRC_PATH := ${UPDATER_SRC_PATH}/${SC_MODULE_BASE}${SC_USR_OPT}
else
$(foreach opt,${SC_HD_OPT_LIST},$(eval $(call updater_usr_opt_process,${opt})))
$(foreach opt,${SC_USR_OPT_LIST},$(eval $(call updater_usr_opt_process,${opt})))
endif

ifeq (path.txt,$(notdir $(wildcard ${UPDATER_SRC_PATH}/path.txt)))
UPDATER_SRC_PATH := ${PREBUILD_DIR}/$(shell ${CAT} $(subst ${BAD_SLASH},${GOOD_SLASH},${UPDATER_SRC_PATH}/path.txt))
endif


##########################################
#     logo PATH
########################################
LOGO_SRC_NAME := logo.bin
LOGO_DST_NAME := logo.bin
LOGO_SRC_PATH := ${ROOT_DIR}/tavor/Arbel/bin/logo
ifneq (,$(findstring _1606_,_${SC_MODULE_BASE}_))
	LOGO_SRC_NAME := logo_no_dsp_adc.bin
endif

ifeq (path.txt,$(notdir $(wildcard ${LOGO_SRC_PATH}/path.txt)))
LOGO_SRC_PATH := ${PREBUILD_DIR}/$(shell ${CAT} $(subst ${BAD_SLASH},${GOOD_SLASH},${LOGO_SRC_PATH}/path.txt))
endif


##########################################
#     RF PATH
########################################
RF_SRC_NAME := rf.bin

ifeq ($(wildcard ${PREBUILD_DIR}/RF/${SC_MODULE_BASE}${SC_USR_OPT}),)
RF_SRC_PATH := ${PREBUILD_DIR}/RF/${SC_MODULE_BASE}
else
RF_SRC_PATH := ${PREBUILD_DIR}/RF/${SC_MODULE_BASE}${SC_USR_OPT}
endif

ifeq (path.txt,$(notdir $(wildcard ${RF_SRC_PATH}/path.txt)))
RF_SRC_PATH := ${PREBUILD_DIR}/$(shell ${CAT} $(subst ${BAD_SLASH},${GOOD_SLASH},${RF_SRC_PATH}/path.txt))
endif

##########################################
#     RD PATH
########################################
RD_SRC_NAME := ReliableData.bin
RD_SRC_PATH := $(KERNEL_SRC_PATH)

endif  # ifneq (,${SIMCOM_RELEASE_SDK})

##########################################
#     PRESET FILES  DRIVE D PATH
########################################
ifneq (,$(SC_HD_CFG))
ifneq (,$(findstring _PFBEF_,_${SC_MODULE_FULL}_))
PF_SRC_NAME := ext_flash.bin
ifneq (,$(findstring _A7680C_LNNV_1602_V801_OPENSDK_YAXON_,_${SC_MODULE_FULL}_))
PF_SRC_PATH := ${PREBUILD_DIR}/ext_flash/YAXON
endif
ifneq (,$(findstring _A7670C_MNNV_1602_V801_OPENSDK_TOPBAND_,_${SC_MODULE_FULL}_))
PF_SRC_PATH := ${PREBUILD_DIR}/ext_flash/TOPBAND
endif
endif
endif

ifeq (TRUE,${FACTORY})
${OUT_DIR}/burn_factory.zip:source
else
${OUT_DIR}/burn.zip:source
endif
	$(ARELEASE) -c $(ABOOT_OUT_DIR) -g -p ${ASR_PRODUCT_TYPE} -v $(ASR_PRODUCT) --release-pack $(subst ${BAD_SLASH},${GOOD_SLASH},$(patsubst %.zip,%_source.zip,$@)) $(subst ${BAD_SLASH},${GOOD_SLASH},$@)


.PHONE: source ${ABOOT_OUT_DIR}

ifneq (,${SIMCOM_RELEASE_SDK})

source: ${ABOOT_OUT_DIR} ${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}

else

source: ${ABOOT_OUT_DIR} ${ABOOT_IMAGES_OUT_DIR}/${KERNEL_SRC_NAME} ${ABOOT_IMAGES_OUT_DIR}/${APN_SRC_NAME} ${ABOOT_IMAGES_OUT_DIR}/${NVM_OUT_NAME} ${ABOOT_IMAGES_OUT_DIR}/${DSP_SRC_NAME} ${ABOOT_IMAGES_OUT_DIR}/${BOOT33_SRC_NAME} ${ABOOT_IMAGES_OUT_DIR}/${UPDATER_SRC_NAME} ${ABOOT_IMAGES_OUT_DIR}/${LOGO_DST_NAME} ${ABOOT_IMAGES_OUT_DIR}/${RF_SRC_NAME} ${ABOOT_IMAGES_OUT_DIR}/${RD_SRC_NAME}

ifneq (,$(SC_HD_CFG))
ifneq (,$(findstring _PFBEF_,_${SC_MODULE_FULL}_))
source: ${ABOOT_OUT_DIR} ${ABOOT_IMAGES_OUT_DIR}/${KERNEL_SRC_NAME} ${ABOOT_IMAGES_OUT_DIR}/${PF_SRC_NAME}
endif
endif

ifneq (,$(findstring OPENSDK,${SC_MODULE_BASE}))
source: ${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}
${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}: ${ABOOT_OUT_DIR} ${ABOOT_IMAGES_OUT_DIR}/${FOTA_PARAM_OUT_NAME}
endif

ifneq (,$(findstring UBIA,${SC_USR_OPT}))
source: ${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}
${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}: ${ABOOT_OUT_DIR} ${ABOOT_IMAGES_OUT_DIR}/${FOTA_PARAM_OUT_NAME}
endif

ifneq (,$(findstring UBLOX,${SC_USR_OPT}))
source: ${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}
${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}: ${ABOOT_OUT_DIR} ${ABOOT_IMAGES_OUT_DIR}/${FOTA_PARAM_OUT_NAME}
endif

ifneq (,$(findstring _ASR5311_,_${GPS_FIRM}_))
source: ${ABOOT_IMAGES_OUT_DIR}/${GPS_OUT_NAME}
else ifneq (,$(findstring _UC6228_,_${GPS_FIRM}_)$(findstring _CC1161W_,_${GPS_FIRM}_)$(findstring _CC1177W_,_${GPS_FIRM}_))
source: ${ABOOT_IMAGES_OUT_DIR}/${GPS_OUT_NAME1}
endif

ifneq (,$(SC_HD_CFG))
ifneq ($(SC_HD_CFG)_$(SC_HD_CFG),$(patsubst _F%,,$(SC_HD_CFG))_$(patsubst _B%,,$(SC_HD_CFG)))
source: ${ABOOT_IMAGES_OUT_DIR}/${BT_SRC_NAME1}
endif
endif

ifneq (,$(SC_HD_CFG))
ifneq (,$(findstring _1602_,_${SC_MODULE_FULL}_)$(findstring _1605_,_${SC_MODULE_FULL}_))
ifneq (,$(findstring _CUSBT_, _${SC_USR_OPT}_))
source: ${ABOOT_IMAGES_OUT_DIR}/${BT_SRC_NAME1}
endif
endif
endif

endif


ifneq (,${SIMCOM_RELEASE_SDK})
${ABOOT_OUT_DIR}:${ABOOT_SRC_PATH}
else
${ABOOT_OUT_DIR}:${ABOOT_CONFIG_SRC_PATH} ${ABOOT_IMAGES_SRC_PATH}
endif
	-${RMDIR} ${RMDIRARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_OUT_DIR})
	${MKDIR} ${MKDIRARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_OUT_DIR})
ifneq (,${SIMCOM_RELEASE_SDK})
ifeq (win32,${PLATFORM})
	${COPY} ${COPYARG} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${ABOOT_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$@/)
else
	${COPY} ${COPYARG} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${ABOOT_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))
endif
else
ifneq (${PREBOOT_CUST_NAME},n)
	${MKDIR} ${MKDIRARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${PREBOOT_CUST_NAME})
	${COPY} ${COPYARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${ABOOT_IMAGES_SRC_NAME}/${PREBOOT_CUST_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${PREBOOT_CUST_NAME}/)
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${ABOOT_IMAGES_SRC_NAME}/${PREBOOT_NAME}/${PREBOOT_BIN}) $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${PREBOOT_BIN})
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${ABOOT_IMAGES_SRC_NAME}/${PREBOOT_CUST_NAME}/${PREBOOT_BIN}) $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${ABOOT_IMAGES_SRC_NAME}/${PREBOOT_NAME}/${PREBOOT_BIN})
	-${RMDIR} ${RMDIRARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${ABOOT_IMAGES_SRC_NAME}/${PREBOOT_CUST_NAME})
endif

	${MKDIR} ${MKDIRARG} $(subst ${BAD_SLASH},${GOOD_SLASH},$@/${ABOOT_CONFIG_SRC_NAME})
	${COPY} ${COPYARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_CONFIG_SRC_PATH}/${ABOOT_CONFIG_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$@/${ABOOT_CONFIG_SRC_NAME}/)
	${MKDIR} ${MKDIRARG} $(subst ${BAD_SLASH},${GOOD_SLASH},$@/${ABOOT_IMAGES_SRC_NAME})
	${COPY} ${COPYARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${ABOOT_IMAGES_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$@/${ABOOT_IMAGES_SRC_NAME}/)

ifneq (${PREBOOT_CUST_NAME},n)
	${MKDIR} ${MKDIRARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${ABOOT_IMAGES_SRC_NAME}/${PREBOOT_CUST_NAME})
	${COPY} ${COPYARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${PREBOOT_CUST_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${ABOOT_IMAGES_SRC_NAME}/${PREBOOT_CUST_NAME}/)
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${PREBOOT_BIN}) $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${ABOOT_IMAGES_SRC_NAME}/${PREBOOT_NAME}/${PREBOOT_BIN})
	-${RMDIR} ${RMDIRARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${PREBOOT_CUST_NAME})
	-${RM} ${RMARG} $(subst ${BAD_SLASH},${GOOD_SLASH},${ABOOT_IMAGES_SRC_PATH}/${PREBOOT_BIN})
endif
endif

ifneq (,$(findstring OPENSDK,${SC_MODULE_BASE}))
${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}:${USERSPACE_SRC_PATH}/${USERSPACE_SRC_NAME}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$<) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))

${ABOOT_IMAGES_OUT_DIR}/${FOTA_PARAM_OUT_NAME}:${FOTA_PARAM_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${FOTA_PARAM_OUT_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))
endif

ifneq (,$(findstring UBIA,${SC_USR_OPT}))
${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}:${USERSPACE_SRC_PATH}/${USERSPACE_SRC_NAME}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$<) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))

${ABOOT_IMAGES_OUT_DIR}/${FOTA_PARAM_OUT_NAME}:${FOTA_PARAM_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${FOTA_PARAM_OUT_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))
endif

ifneq (,$(findstring UBLOX,${SC_USR_OPT}))
${ABOOT_IMAGES_OUT_DIR}/${USERSPACE_SRC_NAME}:${USERSPACE_SRC_PATH}/${USERSPACE_SRC_NAME}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$<) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))

${ABOOT_IMAGES_OUT_DIR}/${FOTA_PARAM_OUT_NAME}:${FOTA_PARAM_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${FOTA_PARAM_OUT_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))
endif

ifeq (,${SIMCOM_RELEASE_SDK})

${ABOOT_IMAGES_OUT_DIR}/${KERNEL_SRC_NAME}:${KERNEL_SRC_PATH}/${KERNEL_SRC_NAME}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$<) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))

${ABOOT_IMAGES_OUT_DIR}/${APN_SRC_NAME}:${KERNEL_SRC_PATH}/${APN_SRC_NAME}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$<) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))


${ABOOT_IMAGES_OUT_DIR}/${NVM_OUT_NAME}:${NVM_SRC_PATH} ${ABOOT_OUT_DIR}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${NVM_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$@)


${ABOOT_IMAGES_OUT_DIR}/${DSP_SRC_NAME}:${DSP_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${DSP_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))

ifneq (,$(findstring _UC6228_,_${GPS_FIRM}_)$(findstring _CC1161W_,_${GPS_FIRM}_)$(findstring _CC1177W_,_${GPS_FIRM}_))
${ABOOT_IMAGES_OUT_DIR}/${GPS_OUT_NAME1}:${GPS_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${GPS_OUT_NAME1}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${GPS_OUT_NAME2}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))
else
${ABOOT_IMAGES_OUT_DIR}/${GPS_OUT_NAME}:${GPS_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${GPS_OUT_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))
endif


${ABOOT_IMAGES_OUT_DIR}/${BOOT33_SRC_NAME}:${BOOT33_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${BOOT33_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))



${ABOOT_IMAGES_OUT_DIR}/${UPDATER_SRC_NAME}:${UPDATER_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${UPDATER_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))



${ABOOT_IMAGES_OUT_DIR}/${BT_SRC_NAME1}:${BT_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${BT_SRC_NAME1}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${BT_SRC_NAME2}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))



${ABOOT_IMAGES_OUT_DIR}/${LOGO_DST_NAME}:${LOGO_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${LOGO_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@)/${LOGO_DST_NAME})



${ABOOT_IMAGES_OUT_DIR}/${RF_SRC_NAME}:${RF_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${RF_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))


${ABOOT_IMAGES_OUT_DIR}/${RD_SRC_NAME}:${RD_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${RD_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))

ifneq (,$(SC_HD_CFG))
ifneq (,$(findstring _PFBEF_,_${SC_MODULE_FULL}_))
${ABOOT_IMAGES_OUT_DIR}/${PF_SRC_NAME}:${PF_SRC_PATH}
	${COPY_FILE} ${COPYARG_FILE} $(subst ${BAD_SLASH},${GOOD_SLASH},$</${PF_SRC_NAME}) $(subst ${BAD_SLASH},${GOOD_SLASH},$(dir $@))
endif
endif

endif  # ifeq (,${SIMCOM_RELEASE_SDK})


