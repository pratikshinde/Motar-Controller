#
# 16xx settings
#

FLASH_TARGET_PRE := CRANEL_A0

ifneq (,$(findstring _1606_,_${SC_MODULE_FULL}_))
ASR_PRODUCT_TYPE := ASR_CRANEL_EVB
#
# Special process
# In SDK_1.011.069, only have dual SIM product type, so ignore to check
# In SDK_1.011.078 and later version, ASR1606L only have use signal SIM product
#
ifneq (,$(findstring _DS_,$(SC_MODULE_FULL)_))
	PRODUCT_SIM_TYPE :=
else
	PRODUCT_SIM_TYPE := _SINGLE_SIM
endif
else ifneq (,$(findstring _1602_,_${SC_MODULE_FULL}_))
FLASH_TARGET_PRE := ASR1602
ASR_PRODUCT_TYPE := ASR1602_EVB
else ifneq (,$(findstring _1603_,_${SC_MODULE_FULL}_))
FLASH_TARGET_PRE := CRANEM_A0
ASR_PRODUCT_TYPE := ASR_CRANEM_EVB
ifeq (TRUE,$(patsubst %A,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
	PRODUCT_SIM_TYPE := _SINGLE_SIM
endif
else ifneq (,$(findstring _1601_,_${SC_MODULE_FULL}_))
FLASH_TARGET_PRE := ASR1601
ASR_PRODUCT_TYPE := ASR1601_EVB
else ifneq (,$(findstring _1607_,_${SC_MODULE_FULL}_))
FLASH_TARGET_PRE := ASR1607
ASR_PRODUCT_TYPE := ASR1607_EVB
else ifneq (,$(findstring _1605_,_${SC_MODULE_FULL}_))
FLASH_TARGET_PRE := ASR1605
ASR_PRODUCT_TYPE := ASR1605_EVB
endif

ifneq ($(word 2,$(subst _, ,$(SC_MODULE_FULL)))$(word 2,$(subst _, ,$(SC_MODULE_FULL)))$(word 2,$(subst _, ,$(SC_MODULE_FULL))),$(patsubst %S,8M,$(word 2,$(subst _, ,$(SC_MODULE_FULL))))$(patsubst %C,8M,$(word 2,$(subst _, ,$(SC_MODULE_FULL))))$(patsubst %A,8M,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
	FLASH_TARGET_SIZE := _08MB
else ifeq (TRUE,$(patsubst %V,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
	FLASH_TARGET_SIZE := _04MB
else ifeq (TRUE,$(patsubst %Y,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
	FLASH_TARGET_SIZE := _02MB
else ifeq (TRUE,$(patsubst %E,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
	FLASH_TARGET_SIZE := _16MB
else ifeq (TRUE,$(patsubst %L,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
	FLASH_TARGET_SIZE := _16MB
else ifneq (,$(findstring A7682E_1603_V102,$(SC_MODULE_FULL))$(findstring A7662E_1603_V102,$(SC_MODULE_FULL)))
	# special product type
	FLASH_TARGET_SIZE := _16MB
else ifneq (,$(findstring A7682E_1603_R_V102,$(SC_MODULE_FULL)))
	# special product type
	FLASH_TARGET_SIZE := _08MB
else ifneq (,$(findstring A7672E_R_1603_V101,$(SC_MODULE_FULL)))
	# special product type
	FLASH_TARGET_SIZE := _08MB
endif

#PARSE FLASH_TARGET_HD START
#BT ADD
ifneq ($(word 2,$(subst _, ,$(SC_MODULE_FULL)))$(word 2,$(subst _, ,$(SC_MODULE_FULL))),$(patsubst F%,,$(word 2,$(subst _, ,$(SC_MODULE_FULL))))$(patsubst B%,,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
	FLASH_TARGET_HD := _BT
endif

#Distinguish between domestic and foreign modules
ifneq (,$(findstring C_,$(word 1,$(subst _, ,$(SC_MODULE_FULL)))_)$(findstring C1_,$(word 1,$(subst _, ,$(SC_MODULE_FULL)))_))
MODULE_TARGET_TYPE := DOMESTIC_MODULE
else
MODULE_TARGET_TYPE := FOREIGN_MODULE
endif

#Distinguish GPS firm
GPS_FIRM := NULL
ifneq ($(word 2,$(subst _, ,$(SC_MODULE_FULL)))$(word 2,$(subst _, ,$(SC_MODULE_FULL)))$(word 2,$(subst _, ,$(SC_MODULE_FULL))),$(patsubst F%,,$(word 2,$(subst _, ,$(SC_MODULE_FULL))))$(patsubst M%,,$(word 2,$(subst _, ,$(SC_MODULE_FULL))))$(patsubst J%,,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
	#special product type
	ifeq (,$(findstring _A7672E_FASE_1603_V201_,_$(SC_MODULE_FULL)_)$(findstring _A7670U_MAMS_1606_V201_,_$(SC_MODULE_FULL)_)$(findstring _A7670NA_MAMS_1606_V201_,_$(SC_MODULE_FULL)_)$(findstring _A7670G_MAMS_1606_V201_,_$(SC_MODULE_FULL)_)$(findstring _A7670E_MAMS_1606_V201_,_$(SC_MODULE_FULL)_)$(findstring _A7670SA_MAMS_1606_V201_,_$(SC_MODULE_FULL)_)$(findstring _A7670G_MNMY_1602_UB_V101_,_$(SC_MODULE_FULL)_)$(findstring _A7672SA_FASE_1603_V201_,_$(SC_MODULE_FULL)_)$(findstring _A7670E_MAMV_1606_V201_,_$(SC_MODULE_FULL)_)$(findstring _A7670SA_MAMV_1606_V201_,_$(SC_MODULE_FULL)_)$(findstring _A7670NA_MNMY_1602_UB_V101_,_$(SC_MODULE_FULL)_)$(findstring _A7670SA_MNMV_1602_V101_,_$(SC_MODULE_FULL)_)$(findstring _A7670E_MNMV_1602_V101_,_$(SC_MODULE_FULL)_)$(findstring _A7600C1_MNXY_1602_V501_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _1605_,_$(SC_MODULE_FULL)_)$(findstring _A7672E_MASA_1603_V301_,_$(SC_MODULE_FULL)_))
			ifneq (,$(findstring _A7671,_$(SC_MODULE_FULL)))
				GPS_FIRM := NULL
			else ifneq ($(word 2,$(subst _, ,$(SC_MODULE_FULL))),$(patsubst M%,,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
				GPS_FIRM := GPS_CC1161W
			else ifneq ($(word 2,$(subst _, ,$(SC_MODULE_FULL))),$(patsubst J%,,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
				GPS_FIRM := GPS_CC1177W
			endif

		else ifneq (,$(findstring A7670,$(SC_MODULE_FULL))$(findstring A7672,$(SC_MODULE_FULL))$(findstring A7677,$(SC_MODULE_FULL))$(findstring A7605,$(SC_MODULE_FULL)))
			GPS_FIRM := GPS_UC6228
		else
			GPS_FIRM := GPS_ASR5311
		endif
	else
		GPS_FIRM := GPS_ASR5311
	endif
endif
#GPS FOR ASR5311, UC6228, CC1161W, CC1177W ADD
ifneq (NULL,$(GPS_FIRM))
	ifneq (,$(findstring _UC6228_,_${GPS_FIRM}_))
		#UC6228 dynamic fw from flash, it is make jason which have fw partition
		ifneq (,$(findstring _1603_,_${SC_MODULE_FULL}_))
			ifeq (_08MB,$(FLASH_TARGET_SIZE))
				#it is make jason which have fw partition
				FLASH_TARGET_HD := $(FLASH_TARGET_HD)_UC6228
			endif
		endif

		ifneq (,$(findstring _1606_,_${SC_MODULE_FULL}_))
			ifeq (_08MB,$(FLASH_TARGET_SIZE))
				ifneq (,$(findstring _DOMESTIC_,_$(MODULE_TARGET_TYPE)_))
					#it is make jason which no have fw partition
					FLASH_TARGET_HD := $(FLASH_TARGET_HD)
				else
					#it is make jason which have fw partition
					FLASH_TARGET_HD := $(FLASH_TARGET_HD)_UC6228
				endif
			endif
		endif

		ifeq (_16MB,$(FLASH_TARGET_SIZE))
			FLASH_TARGET_HD := $(FLASH_TARGET_HD)_UC6228
		endif
	else ifneq (,$(findstring _CC1161W_,_${GPS_FIRM}_))
		FLASH_TARGET_HD := $(FLASH_TARGET_HD)_CC1161W
	else ifneq (,$(findstring _CC1177W_,_${GPS_FIRM}_))
		FLASH_TARGET_HD := $(FLASH_TARGET_HD)_CC1161W
	else
		FLASH_TARGET_HD := $(FLASH_TARGET_HD)_ASR5311
	endif
endif
#PARSE FLASH_TARGET_HD END

# STANDARD FLASH_TARGET_CUSTOM START
ifneq (,$(findstring _VOLTE_,_$(SC_MODULE_FULL)_))
	ifeq (TRUE,$(patsubst %V,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
		FLASH_TARGET_CUSTOM := _VOLTE
	endif
else ifneq (,$(findstring _BGDZ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _APP_768K
else ifneq (,$(findstring _GWSD_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _GWSD
else ifneq (,$(findstring _SHHD_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _SHHD
else ifneq (,$(findstring _YHWL_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _APP_512K
else ifneq (,$(findstring _WHXBY_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _APP_512K
else ifneq (,$(findstring _A7680C_LANS_1606_XC_,_$(SC_MODULE_FULL)_)$(findstring _A7670C_LANS_1606_V701_XC_,_$(SC_MODULE_FULL)_)$(findstring _AJBDZ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _APP_512K
else ifneq (,$(findstring _A7680C_LANV_1606_V503_XC_,_$(SC_MODULE_FULL)_)$(findstring _A7670C_LANV_1606_V701_XC_,_$(SC_MODULE_FULL)_)$(findstring _XMWE_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _APP_320K
else ifneq (,$(findstring _BL_POC_MMI_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _APP_512K
else ifneq (,$(findstring _GRWT_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _GRWT
else ifneq (,$(findstring _ST_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _ST
else ifneq (,$(findstring _XYJ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _XYJ
else ifneq (,$(findstring _ZS_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _ZS
else ifneq (,$(findstring _GZYM_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _GZYM
else ifneq (,$(findstring _QZZT_POC_MMI_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _QZZT
else ifneq (,$(findstring _HX_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _HX
    ifneq (,$(findstring _CUSAUDIO_,_$(SC_MODULE_FULL)_))
        FLASH_TARGET_CUSTOM := _HX_AUDIO
    endif
else ifneq (,$(findstring _HQ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _HQ
else ifneq (,$(findstring _LDJD_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _LDJD
else ifneq (,$(findstring _MT_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _MT
else ifneq (,$(findstring _YKKJ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _YKKJ
else ifneq (,$(findstring _QZXC_POC_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _QZXC_POC
else ifneq (,$(findstring _PWY_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _PWY
else ifneq (,$(findstring _JXTZ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _JXTZ
else ifneq (,$(findstring _A7670C_LANS_1606_V701_CZJ_POC_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _CZJ
else ifneq (,$(findstring _SJ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _SJ
else ifneq (,$(findstring _DYDZ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _DYDZ
else ifneq (,$(findstring _DF_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _DF
else ifneq (,$(findstring _VOLTE_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _VOLTE
else ifneq (,$(findstring _TTS_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _TTS
    ifneq (,$(findstring _ZTAC_,_$(SC_MODULE_FULL)_))
            FLASH_TARGET_CUSTOM := _ZTAC
    endif
else ifneq (,$(findstring _LARGENVM_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _LARGENVM
	ifneq (,$(findstring _EARTAG_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _EARTAG
	endif
else ifneq (,$(findstring _UCVSIM_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _UCVSIM
else ifneq (,$(findstring _ONOMONDO_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _ONOMONDO
else ifneq (,$(findstring _ZM_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _ZM
else ifneq (,$(findstring _RU_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _RU
else ifneq (,$(findstring _SAFONE_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _SAFONE
else ifneq (,$(findstring _GZZX_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _GZZX
else ifneq (,$(findstring _EP_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _EP
else ifneq (,$(findstring _ZZCXNY_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _ZZCXNY
else ifneq (,$(findstring _A7680C_LANS_1606_V506_CQCY_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _CQCY
else ifneq (,$(findstring _SHDQ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _SHDQ
else ifneq (,$(findstring _A7680C_LNNV_1602_V801_OPENSDK_YJ_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _YJ
else ifneq (,$(findstring _FOTA_,_$(SC_MODULE_FULL)_))
    ifneq (,$(findstring _1603_,_${SC_MODULE_FULL}_))
        FLASH_TARGET_CUSTOM := _FOTA
    endif
else ifneq (,$(findstring _CUSAUDIO_,_$(SC_MODULE_FULL)_))
    ifneq (,$(findstring _A7680C_MANV_,_${SC_MODULE_FULL}_))
        FLASH_TARGET_CUSTOM := _AUDIO
    endif

    ifneq (,$(findstring _WHLL_,_$(SC_MODULE_FULL)_))
        ifneq (,$(findstring _A7690C_MAXV_1607_,_$(SC_MODULE_FULL)_))
            FLASH_TARGET_CUSTOM := _WHLL
        endif
    endif
else ifneq (,$(findstring _A7670G_LNMY_1602_UB_V101_,_$(SC_MODULE_FULL)_)$(findstring _A7670G_MNMY_1602_UB_V101_,_$(SC_MODULE_FULL)_)$(findstring _A7670NA_MNMY_1602_UB_V101_,_$(SC_MODULE_FULL)_)$(findstring _A7670NA_LNMY_1602_UB_V101_,_$(SC_MODULE_FULL)_)$(findstring _A7670G_MNXY_1605_,_$(SC_MODULE_FULL)_))
	ifneq (,$(findstring _UBIA_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _GLOBAL_UBIA
	else
		FLASH_TARGET_CUSTOM := _GLOBAL
	endif
else ifneq (,$(findstring _UBIA_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _UBIA
else ifneq (,$(findstring _WHKC_,_$(SC_MODULE_FULL)_))
    ifneq (,$(findstring _A7680C_MNNV_,_${SC_MODULE_FULL}_))
        FLASH_TARGET_CUSTOM := _WHKC
    endif
else ifneq (,$(findstring _ULTRASTAR_,_$(SC_MODULE_FULL)_))
    ifneq (,$(findstring _A7682EC_LASA_,_${SC_MODULE_FULL}_))
        FLASH_TARGET_CUSTOM := _ULTRASTAR
    endif
else ifneq (,$(findstring _ENPLUS_,_$(SC_MODULE_FULL)_))
    ifneq (,$(findstring _A7670E_LASA_,_${SC_MODULE_FULL}_)$(findstring _A7670SA_LASA_,_${SC_MODULE_FULL}_))
        FLASH_TARGET_CUSTOM := _ENPLUS
    endif
else ifneq (,$(findstring _XLKJ_,_$(SC_MODULE_FULL)_))
    ifneq (,$(findstring _A7690C_MAXV_1607_V301_,_${SC_MODULE_FULL}_))
        FLASH_TARGET_CUSTOM := _XLKJ
    endif
else ifneq (,$(findstring _UBLOX_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _UBLOX
else ifneq (,$(findstring _LARGEBOOTLDR_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _LARGEBOOTLDR
else ifneq (,$(findstring _WHEELSEYE_,_$(SC_MODULE_FULL)_))
	FLASH_TARGET_CUSTOM := _WHEELSEYE
else ifneq (,$(findstring _CT_,_$(SC_MODULE_FULL)_))
    ifneq (,$(findstring _A7672S_LASA_,_${SC_MODULE_FULL}_))
        FLASH_TARGET_CUSTOM := _CT
    endif
else
	FLASH_TARGET_CUSTOM :=
endif
# STANDARD FLASH_TARGET_CUSTOM END

# OPENSDK FLASH_TARGET_CUSTOM START
ifneq (,$(findstring _OPENSDK,$(SC_MODULE_BASE)))
	ifneq (,$(findstring _IMSSMS_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _IMSSMS
		ifneq (,$(findstring _TTS_,_$(SC_MODULE_FULL)_))
			FLASH_TARGET_CUSTOM := _TTS
		endif
		ifneq (,$(findstring _GZGSF_,_$(SC_MODULE_FULL)_))
			FLASH_TARGET_CUSTOM := _IMSSMS_GZGSF
		endif
	endif

	ifneq (,$(findstring _HAIER_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7680C_LANS_1606_V506_,_${SC_MODULE_FULL}_))
			FLASH_TARGET_CUSTOM := _HAIER
		endif
	endif

	ifneq (,$(findstring _1602_,_${SC_MODULE_FULL}_))
		ifeq (TRUE,$(patsubst %V,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
			ifneq (,$(findstring _FULLFOTA_,_$(SC_MODULE_FULL)_))
					FLASH_TARGET_CUSTOM := _FULLFOTA
			endif

			ifneq (,$(findstring _LNNV_,_${SC_MODULE_FULL}_))
				ifneq (,$(findstring _YJ_,_${SC_MODULE_FULL}_))
					FLASH_TARGET_CUSTOM := _YJ
				endif
			endif
		endif
	endif

	ifneq (,$(findstring _1602_,_${SC_MODULE_FULL}_)$(findstring _1605_,_${SC_MODULE_FULL}_))
		ifneq (,$(findstring _YAXON_,_$(SC_MODULE_FULL)_))
			ifneq (,$(findstring _EXTWDG_,_$(SC_MODULE_FULL)_))
				FLASH_TARGET_CUSTOM := _YAXON_EXTWDG
			else ifneq (,$(findstring _TTS_,_${SC_MODULE_FULL}_))
				ifneq (,$(findstring _PFBEF_,_${SC_MODULE_FULL}_))
					FLASH_TARGET_CUSTOM := _YAXON_TTS_PFBEF
				else
					FLASH_TARGET_CUSTOM := _YAXON_TTS
				endif
			else ifneq (,$(findstring _IMSSMS_,_${SC_MODULE_FULL}_))
				ifneq (,$(findstring _PFBEF_,_${SC_MODULE_FULL}_))
					FLASH_TARGET_CUSTOM := _YAXON_IMSSMS_PFBEF
				else
					FLASH_TARGET_CUSTOM := _YAXON_IMSSMS
				endif
			else
				FLASH_TARGET_CUSTOM := _YAXON
			endif
		endif
	endif

	ifneq (,$(findstring _YJ_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _1605_,_${SC_MODULE_FULL}_))
			FLASH_TARGET_CUSTOM := _YJ
		endif
	endif

	ifneq (,$(findstring _XC_,_$(SC_MODULE_FULL)_)$(findstring _ZC_,_$(SC_MODULE_FULL)_)$(findstring _ZHXL_,_$(SC_MODULE_FULL)_)$(findstring _APP512K_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _APP_512K
	endif
	ifneq (,$(findstring _JS_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _1606_,_${SC_MODULE_FULL}_))
			FLASH_TARGET_CUSTOM := _JS
		endif
	endif
	ifneq (,$(findstring _XYJ_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _XYJ_768K
	endif
	ifneq (,$(findstring _LP_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _LP
	endif
	ifneq (,$(findstring _WWKJ_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _WWKJ
	endif
	ifneq (,$(findstring _ZJ_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _ZJ
	endif
	ifneq (,$(findstring _ZXZN_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _ZXZN
	endif
	ifneq (,$(findstring _JWZD_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _1606_,_${SC_MODULE_FULL}_))
			FLASH_TARGET_CUSTOM := _APP_512K
		else ifneq (,$(findstring _1602_,_${SC_MODULE_FULL}_))
			FLASH_TARGET_CUSTOM := _JWZD
		else ifneq (,$(findstring _1603_,_${SC_MODULE_FULL}_))
			FLASH_TARGET_CUSTOM := _JWZD
		else
		endif
	endif

	ifneq (,$(findstring _FILESYSTEM_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _FS
	endif

	ifneq (,$(findstring _TBDTU_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _TBDTU
	endif

	ifneq (,$(findstring _SZKZX_,_${SC_MODULE_FULL}_))
		FLASH_TARGET_CUSTOM := _APP_384K
	endif

	ifneq (,$(findstring _PDKJ_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _PDKJ
	endif

	ifneq (,$(findstring _WALNUT_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7677S_LANS_,_$(SC_MODULE_FULL)_)$(findstring _A7672S_LASC_,_$(SC_MODULE_FULL)_)$(findstring _A7677S_LANV_,_$(SC_MODULE_FULL)_))
			ifneq (,$(findstring _APP768K_,_${SC_MODULE_FULL}_))
				FLASH_TARGET_CUSTOM := _APP_768K
			else
				FLASH_TARGET_CUSTOM := _WALNUT
			endif
		endif
		ifneq (,$(findstring _A7682S_LNXV_,_$(SC_MODULE_FULL)_))
				FLASH_TARGET_CUSTOM := _WALNUT
		endif
	endif
	ifneq (,$(findstring _XYZL_,_$(SC_MODULE_FULL)_))
		FLASH_TARGET_CUSTOM := _XYZL
	endif

	ifneq (,$(findstring _YUNHAI_,_${SC_MODULE_FULL}_))
		ifeq (4M,$(patsubst %V,4M,$(SC_MODULE_FULL)))
			FLASH_TARGET_CUSTOM := _YUNHAI
		endif
	endif

	ifneq (,$(findstring _GTK_,_${SC_MODULE_FULL}_))
		FLASH_TARGET_CUSTOM := _GTK
	endif
	ifneq (,$(findstring _HTTX_,_${SC_MODULE_FULL}_))
		ifneq (,$(findstring _1602_,_${SC_MODULE_FULL}_))
			ifeq (TRUE,$(patsubst %V,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
				FLASH_TARGET_CUSTOM := _HTTX
			endif
		endif
	endif

	ifneq (,$(findstring _CSSMS_,_${SC_MODULE_FULL}_))
		ifneq (,$(findstring _1602_,_${SC_MODULE_FULL}_))
			FLASH_TARGET_CUSTOM := _CSSMS
		endif
	endif
	ifneq (,$(findstring _KDWL_,_${SC_MODULE_FULL}_))
		ifneq (,$(findstring _1602_,_${SC_MODULE_FULL}_))
			ifeq (TRUE,$(patsubst %V,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
				FLASH_TARGET_CUSTOM := _APP_384K
			endif
		endif
	endif

	ifneq (,$(findstring _CUSBT_,_${SC_MODULE_FULL}_))
		ifeq (TRUE,$(patsubst %V,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
			FLASH_TARGET_CUSTOM := _BT
		endif
	endif

	ifneq (,$(findstring _1603_,_${SC_MODULE_FULL}_))
		ifneq ($(word 2,$(subst _, ,$(SC_MODULE_FULL))),$(patsubst %A,8M,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
			ifneq (,$(findstring _SZRL_,_${SC_MODULE_FULL}_))
				FLASH_TARGET_CUSTOM := _SZRL
			endif
			ifneq (,$(findstring _VOLTE_,_${SC_MODULE_FULL}_))
				FLASH_TARGET_CUSTOM := _VOLTE
			endif
			ifneq (,$(findstring _NODYLDR_,_${SC_MODULE_FULL}_))
				FLASH_TARGET_CUSTOM := _VOLTE_NODYLDR
			endif
			ifneq (,$(findstring _CWXT_,_${SC_MODULE_FULL}_))
				FLASH_TARGET_CUSTOM := _CWXT
			endif
			ifneq (,$(findstring _CZJ_,_${SC_MODULE_FULL}_))
				FLASH_TARGET_CUSTOM := _CZJ
			endif

			ifneq (,$(findstring _WWKJ_,_${SC_MODULE_FULL}_))
				FLASH_TARGET_CUSTOM := _WWKJ
			endif

			ifneq (,$(findstring _CSWS_,_${SC_MODULE_FULL}_))
				FLASH_TARGET_CUSTOM := _CSWS
			endif
		endif

		ifneq (,$(findstring _CZJ_,_${SC_MODULE_FULL}_))
			ifneq (,$(findstring _LASC_,_$(SC_MODULE_FULL)_))
				FLASH_TARGET_CUSTOM := _CZJ_TTS
			endif
		endif

	endif
	ifneq (,$(findstring _CWXT_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7670SA_LNMV_,_$(SC_MODULE_FULL)_)$(findstring _A7670E_LNMV_,_$(SC_MODULE_FULL)_))
				ifneq (,$(findstring _IMSSMS_,_${SC_MODULE_FULL}_))
					FLASH_TARGET_CUSTOM := _CWXT_IMSSMS
				else
					FLASH_TARGET_CUSTOM := _CWXT
				endif
		endif
	endif

	ifneq (,$(findstring _LINKWELL_,_${SC_MODULE_FULL}_)$(findstring _METER_,_${SC_MODULE_FULL}_))
		ifneq (,$(findstring _1602_,_${SC_MODULE_FULL}_))
			ifeq (TRUE,$(patsubst %Y,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
				FLASH_TARGET_CUSTOM := _LINKWELL
			endif
		endif
	endif

	ifneq (,$(findstring _BSJ_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7680C_LNNV_1602_V801_OPENSDK_TTS_,_$(SC_MODULE_FULL)_))
			FLASH_TARGET_CUSTOM := _TTS_APP_128K
		endif
		ifneq (,$(findstring _A7680C_LNNV_1602_V801_OPENSDK_CUSAUDIO_,_$(SC_MODULE_FULL)_))
			FLASH_TARGET_CUSTOM := _APP_256K
		endif
	endif

	ifneq (,$(findstring _ECOZEN_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7677S_FAXV_,_$(SC_MODULE_FULL)_))
				FLASH_TARGET_CUSTOM := _ECOZEN
		endif
	endif

	ifneq (,$(findstring _XTL_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7670SA_LASA_,_$(SC_MODULE_FULL)_)$(findstring _A7670E_LASA_,_$(SC_MODULE_FULL)_))
				FLASH_TARGET_CUSTOM := _XTL
		endif
	endif

	ifneq (,$(findstring _PMDTU_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _1603_,_${SC_MODULE_FULL}_))
			ifneq ($(word 2,$(subst _, ,$(SC_MODULE_FULL))),$(patsubst %A,8M,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
				FLASH_TARGET_CUSTOM := _PMDTU
			endif
		endif
	endif


	ifneq (,$(findstring _ADSUN_,_$(SC_MODULE_FULL)_)$(findstring _3SCORP_,_$(SC_MODULE_FULL)_)$(findstring _BINHANH_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7677S_MANS_1606_V702_OPENSDK_,_$(SC_MODULE_FULL)_))
				FLASH_TARGET_CUSTOM := _APP_384K
		endif
	endif

	ifneq (,$(findstring _WHLL_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7690C_MAXV_1607_,_$(SC_MODULE_FULL)_))
			FLASH_TARGET_CUSTOM := _WHLL
		endif
	endif

	ifneq (,$(findstring _HIK_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7680E_MNXY_1607_V905_,_$(SC_MODULE_FULL)_))
			FLASH_TARGET_CUSTOM := _HIK
		endif
	endif

	ifneq (,$(findstring _BWS_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7672SA_MASA_1603_,_$(SC_MODULE_FULL)_))
			FLASH_TARGET_CUSTOM := _BWS
		endif
	endif

	ifneq (,$(findstring _QGWLTRACKER_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7670SA_LNMV_1602_,_$(SC_MODULE_FULL)_))
			ifneq (,$(findstring _AUDIO_,_$(SC_MODULE_FULL)_))
				FLASH_TARGET_CUSTOM := _QGWLTRACKER_AUDIO
			endif
		endif
	endif

	ifneq (,$(findstring _TOPBAND_,_$(SC_MODULE_FULL)_))
		ifneq (,$(findstring _A7670C_MNNV_1602_V801_,_${SC_MODULE_FULL}_))
			ifneq (,$(findstring _TTS_,_$(SC_MODULE_FULL)_))
				FLASH_TARGET_CUSTOM := _TTS
				ifneq (,$(findstring _PFBEF_,_$(SC_MODULE_FULL)_))
					FLASH_TARGET_CUSTOM := _TTS_PFBEF
				endif
			endif
		endif
	endif

	ifneq (,$(findstring _HXCORE_,_${SC_MODULE_FULL}_))
		ifeq (TRUE,$(patsubst %V,TRUE,$(word 2,$(subst _, ,$(SC_MODULE_FULL)))))
			ifneq (,$(findstring _TTS_,_${SC_MODULE_FULL}_))
				FLASH_TARGET_CUSTOM := _HXCORE_TTS
			endif
		endif
	endif

endif

# OPENSDK FLASH_TARGET_CUSTOM END

ifneq (,$(findstring _OPENSDK,$(SC_MODULE_BASE)))
ASR_PRODUCT := $(FLASH_TARGET_PRE)$(PRODUCT_SIM_TYPE)$(FLASH_TARGET_SIZE)$(FLASH_TARGET_HD)$(FLASH_TARGET_CUSTOM)_OPENSDK
else
ASR_PRODUCT := $(FLASH_TARGET_PRE)$(PRODUCT_SIM_TYPE)$(FLASH_TARGET_SIZE)$(FLASH_TARGET_HD)$(FLASH_TARGET_CUSTOM)
endif
