import random
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, OtpChallenge, RefreshToken
from app.schemas import (
    SendOtpRequest, VerifyOtpRequest, LoginPasswordRequest,
    RefreshTokenRequest, MfaVerifyRequest, MfaCodeRequest, RegisterRequest
)
from app.services.jwt_auth import (
    sign_token, verify_token, generate_refresh_token,
    hash_refresh_token, verify_secret, hash_secret
)
from app.services.totp_service import (
    generate_secret, build_otpauth_url, generate_qr_base64, verify_totp
)
from app.services.notification_service import send_sms_otp
from app.api.deps import get_current_user

router = APIRouter(tags=["Authentication"])

def format_user_response(user: User):
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "phone_number": user.phone_number,
        "email": user.email,
        "role": user.role,
        "dealer_depth": user.dealer_depth,
        "hierarchy_path": user.hierarchy_path,
        "preferred_language": user.preferred_language,
        "mfa_enabled": user.mfa_enabled,
        "status": user.status,
    }

@router.post("/send-otp")
async def send_otp(req: SendOtpRequest, db: Session = Depends(get_db)):
    clean_phone = req.phone_number.strip().replace(" ", "")

    # Check if user exists in database before generating OTP
    user = db.query(User).filter((User.phone == clean_phone) | (User.phone_number == clean_phone)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mobile number is not registered. Please register first."
        )

    otp_code = str(random.randint(100000, 999999))
    expires_at = datetime.utcnow() + timedelta(minutes=5)

    challenge = db.query(OtpChallenge).filter(OtpChallenge.phone_number == clean_phone).first()
    if challenge:
        challenge.otp_code = otp_code
        challenge.expires_at = expires_at
        challenge.attempts = 0
    else:
        challenge = OtpChallenge(
            phone_number=clean_phone,
            otp_code=otp_code,
            expires_at=expires_at,
            attempts=0
        )
        db.add(challenge)
    db.commit()

    sms_res = await send_sms_otp(clean_phone, otp_code)

    return {
        "message": f"OTP sent successfully to {clean_phone}",
        "phone_number": clean_phone,
        "sms": sms_res,
        "dev_otp": otp_code # Logged for testing
    }

@router.post("/verify-otp")
async def verify_otp(req: VerifyOtpRequest, db: Session = Depends(get_db)):
    clean_phone = req.phone_number.strip().replace(" ", "")
    challenge = db.query(OtpChallenge).filter(OtpChallenge.phone_number == clean_phone).first()
    if not challenge or challenge.otp_code != req.otp_code.strip():
        raise HTTPException(status_code=400, detail="Invalid OTP code")

    if challenge.expires_at.replace(tzinfo=None) < datetime.utcnow():
        raise HTTPException(status_code=400, detail="OTP expired. Request a new code.")

    # Find or auto-provision user
    user = db.query(User).filter(User.phone_number == clean_phone).first()
    if not user:
        import uuid
        user_id = uuid.uuid4()
        user = User(
            id=user_id,
            full_name="New Customer",
            phone_number=clean_phone,
            role="customer",
            dealer_depth=0,
            hierarchy_path=str(user_id)
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # If user has MFA enabled, return temporary challenge token
    if user.mfa_enabled and user.totp_secret:
        temp_token = sign_token({"sub": str(user.id), "mfa_pending": True}, expires_in_seconds=300)
        return {
            "mfa_required": True,
            "temp_token": temp_token,
            "user": format_user_response(user)
        }

    # Issue access and refresh tokens
    access_token = sign_token({
        "sub": str(user.id),
        "role": user.role,
        "hierarchy_path": user.hierarchy_path
    })
    raw_refresh = generate_refresh_token()
    token_hash = hash_refresh_token(raw_refresh)
    
    refresh_rec = RefreshToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=datetime.utcnow() + timedelta(days=30)
    )
    db.add(refresh_rec)
    # Clear challenge
    db.delete(challenge)
    db.commit()

    return {
        "access_token": access_token,
        "refresh_token": raw_refresh,
        "user": format_user_response(user)
    }

@router.post("/login-password")
async def login_password(req: LoginPasswordRequest, db: Session = Depends(get_db)):
    clean_phone = req.phone_number.strip().replace(" ", "")
    user = db.query(User).filter((User.phone == clean_phone) | (User.phone_number == clean_phone)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mobile number is not registered. Please create an account first."
        )

    if not user.password_hash or not verify_secret(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please check your password and try again."
        )

    if user.status == "SUSPENDED":
        raise HTTPException(status_code=403, detail="Account suspended")

    if user.mfa_enabled and user.totp_secret:
        temp_token = sign_token({"sub": str(user.id), "mfa_pending": True}, expires_in_seconds=300)
        return {
            "mfa_required": True,
            "temp_token": temp_token,
            "user": format_user_response(user)
        }

    access_token = sign_token({
        "sub": str(user.id),
        "role": user.role,
        "hierarchy_path": user.hierarchy_path
    })
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=datetime.utcnow() + timedelta(days=30)
    ))
    db.commit()

    return {
        "access_token": access_token,
        "refresh_token": raw_refresh,
        "user": format_user_response(user)
    }

@router.post("/refresh")
async def refresh_token(req: RefreshTokenRequest, db: Session = Depends(get_db)):
    token_hash = hash_refresh_token(req.refresh_token)
    rec = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked_at.is_(None)
    ).first()

    if not rec or rec.expires_at.replace(tzinfo=None) < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user = db.query(User).filter(User.id == rec.user_id).first()
    if not user or user.status == "SUSPENDED":
        raise HTTPException(status_code=401, detail="User inactive or suspended")

    # Rotate refresh token
    new_raw_refresh = generate_refresh_token()
    rec.revoked_at = datetime.utcnow()
    
    new_rec = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(new_raw_refresh),
        expires_at=datetime.utcnow() + timedelta(days=30)
    )
    db.add(new_rec)
    rec.replaced_by = new_rec.id
    db.commit()

    access_token = sign_token({
        "sub": str(user.id),
        "role": user.role,
        "hierarchy_path": user.hierarchy_path
    })

    return {
        "access_token": access_token,
        "refresh_token": new_raw_refresh
    }

@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Revoke all active refresh tokens for user
    db.query(RefreshToken).filter(
        RefreshToken.user_id == current_user.id,
        RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": datetime.utcnow()})
    db.commit()
    return {"message": "Logged out successfully"}

@router.post("/mfa/setup")
async def mfa_setup(current_user: User = Depends(get_current_user)):
    secret = generate_secret()
    url = build_otpauth_url(secret, current_user.phone_number)
    qr = generate_qr_base64(url)
    return {"secret": secret, "otpauth_url": url, "qr_code": qr}

@router.post("/mfa/enable")
async def mfa_enable(
    req: MfaCodeRequest,
    secret: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_totp(secret, req.code):
        raise HTTPException(status_code=400, detail="Invalid code. MFA setup failed.")
    current_user.mfa_enabled = True
    current_user.totp_secret = secret
    db.commit()
    return {"message": "MFA enabled successfully"}

@router.post("/mfa/disable")
async def mfa_disable(
    req: MfaCodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not current_user.totp_secret or not verify_totp(current_user.totp_secret, req.code):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
    current_user.mfa_enabled = False
    current_user.totp_secret = None
    db.commit()
    return {"message": "MFA disabled"}

@router.post("/mfa/verify")
async def mfa_verify(req: MfaVerifyRequest, db: Session = Depends(get_db)):
    payload = verify_token(req.temp_token)
    if not payload or not payload.get("mfa_pending"):
        raise HTTPException(status_code=401, detail="Invalid MFA challenge session")
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=400, detail="MFA not configured on account")
    if not verify_totp(user.totp_secret, req.totp_code):
        raise HTTPException(status_code=400, detail="Invalid MFA verification code")

    access_token = sign_token({
        "sub": str(user.id),
        "role": user.role,
        "hierarchy_path": user.hierarchy_path
    })
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=datetime.utcnow() + timedelta(days=30)
    ))
    db.commit()

    return {
        "access_token": access_token,
        "refresh_token": raw_refresh,
        "user": format_user_response(user)
    }

@router.post("/register")
async def register_user(req: RegisterRequest, db: Session = Depends(get_db)):
    phone_input = req.phone_number or req.phone
    clean_phone = phone_input.strip().replace(" ", "") if phone_input else None
    clean_email = req.email.strip().lower() if req.email else None

    if not clean_phone and not clean_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of phone number or email must be provided"
        )

    if clean_phone:
        existing_phone = db.query(User).filter(User.phone == clean_phone).first()
        if existing_phone:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Phone number is already registered"
            )

    if clean_email:
        existing_email = db.query(User).filter(User.email == clean_email).first()
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email address is already registered"
            )

    import uuid
    user_id = uuid.uuid4()
    password_h = hash_secret(req.password)

    new_user = User(
        id=user_id,
        full_name=req.full_name.strip(),
        phone=clean_phone,
        email=clean_email,
        password_hash=password_h,
        is_active=True,
        is_verified=False
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    access_token = sign_token({
        "sub": str(new_user.id),
        "role": new_user.role,
        "hierarchy_path": new_user.hierarchy_path
    })
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=new_user.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=datetime.utcnow() + timedelta(days=30)
    ))
    db.commit()

    return {
        "access_token": access_token,
        "refresh_token": raw_refresh,
        "user": format_user_response(new_user)
    }

@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return format_user_response(current_user)
