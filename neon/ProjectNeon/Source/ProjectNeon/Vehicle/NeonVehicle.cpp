#include "Vehicle/NeonVehicle.h"
#include "Player/NeonCharacter.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCIdentityComponent.h"
#include "Core/NeonSimSubsystem.h"
#include "World/NeonMaterials.h"
#include "ProjectNeon.h"
#include "Components/BoxComponent.h"
#include "Components/InputComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/PointLightComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Camera/CameraComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"
#include "Engine/World.h"

namespace
{
	// wheel mounts relative to the body centre (cm): FL, FR, RL, RR
	const FVector Mounts[4] = { FVector(135, -80, -15), FVector(135, 80, -15), FVector(-135, -80, -15), FVector(-135, 80, -15) };
}

ANeonVehicle::ANeonVehicle()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;

	Body = CreateDefaultSubobject<UBoxComponent>(TEXT("Body"));
	Body->SetBoxExtent(FVector(225, 92, 38));
	Body->SetSimulatePhysics(true);
	Body->SetCollisionProfileName(TEXT("PhysicsActor"));
	Body->SetNotifyRigidBodyCollision(true);
	Body->SetLinearDamping(0.02f);
	Body->SetAngularDamping(0.8f);
	Body->BodyInstance.bOverrideMass = true;
	Body->BodyInstance.SetMassOverride(MassKg);
	RootComponent = Body;

	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cyl(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	auto MakeMesh = [&](const TCHAR* Name, UStaticMesh* Mesh, const FVector& Loc, const FVector& Scale, const FRotator& Rot = FRotator::ZeroRotator)
	{
		UStaticMeshComponent* M = CreateDefaultSubobject<UStaticMeshComponent>(Name);
		M->SetupAttachment(Body);
		if (Mesh) M->SetStaticMesh(Mesh);
		M->SetRelativeLocationAndRotation(Loc, Rot);
		M->SetRelativeScale3D(Scale);
		M->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		return M;
	};
	Chassis = MakeMesh(TEXT("Chassis"), Cube.Object, FVector(0, 0, -2), FVector(4.6f, 1.88f, 0.62f));
	Cabin = MakeMesh(TEXT("Cabin"), Cube.Object, FVector(-35, 0, 52), FVector(2.2f, 1.62f, 0.5f));
	for (int32 i = 0; i < 4; ++i)
		WheelMeshes[i] = MakeMesh(*FString::Printf(TEXT("Wheel%d"), i), Cyl.Object, Mounts[i] - FVector(0, 0, RestLength), FVector(0.68f, 0.68f, 0.26f), FRotator(0, 0, 90));

	HeadlightL = CreateDefaultSubobject<USpotLightComponent>(TEXT("HeadlightL"));
	HeadlightR = CreateDefaultSubobject<USpotLightComponent>(TEXT("HeadlightR"));
	for (USpotLightComponent* L : { HeadlightL, HeadlightR })
	{
		L->SetupAttachment(Body);
		L->SetIntensityUnits(ELightUnits::Candelas);
		L->SetIntensity(0.f);
		L->SetAttenuationRadius(5000.f);
		L->SetInnerConeAngle(12.f);
		L->SetOuterConeAngle(32.f);
		L->SetLightColor(FLinearColor(1.f, 0.95f, 0.85f));
		L->SetRelativeRotation(FRotator(-6, 0, 0));
	}
	HeadlightL->SetRelativeLocation(FVector(232, -62, 5));
	HeadlightR->SetRelativeLocation(FVector(232, 62, 5));
	TailLights = CreateDefaultSubobject<UPointLightComponent>(TEXT("TailLights"));
	TailLights->SetupAttachment(Body);
	TailLights->SetRelativeLocation(FVector(-240, 0, 5));
	TailLights->SetIntensityUnits(ELightUnits::Candelas);
	TailLights->SetIntensity(0.f);
	TailLights->SetAttenuationRadius(350.f);
	TailLights->SetLightColor(FLinearColor(1.f, 0.05f, 0.02f));

	CameraArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraArm"));
	CameraArm->SetupAttachment(Body);
	CameraArm->TargetArmLength = 650.f;
	CameraArm->SocketOffset = FVector(0, 0, 170);
	CameraArm->bUsePawnControlRotation = true;
	CameraArm->bEnableCameraLag = true;
	CameraArm->CameraLagSpeed = 8.f;
	CameraArm->bEnableCameraRotationLag = true;
	CameraArm->CameraRotationLagSpeed = 6.f;
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(CameraArm);
	bUseControllerRotationYaw = false;
	AutoPossessAI = EAutoPossessAI::Disabled;
}

void ANeonVehicle::BeginPlay()
{
	Super::BeginPlay();
	Body->SetMassOverrideInKg(NAME_None, MassKg, true);
	Body->SetCenterOfMass(FVector(0, 0, -28)); // low centre of mass: stable but still rolls in corners
	Body->OnComponentHit.AddDynamic(this, &ANeonVehicle::OnBodyHit);
	SetPaint(Paint);
}

void ANeonVehicle::SetPaint(const FLinearColor& C)
{
	Paint = C;
	Chassis->SetMaterial(0, NeonMaterials::Surface(this, C, 0.25f, 0.6f));
	Cabin->SetMaterial(0, NeonMaterials::Surface(this, FLinearColor(0.02f, 0.025f, 0.03f), 0.05f, 0.9f)); // tinted glass look
	for (UStaticMeshComponent* W : WheelMeshes) W->SetMaterial(0, NeonMaterials::Surface(this, FLinearColor(0.015f, 0.015f, 0.015f), 0.85f, 0.f));
}

void ANeonVehicle::SetupPlayerInputComponent(UInputComponent* In)
{
	Super::SetupPlayerInputComponent(In);
	In->BindAxis(TEXT("MoveForward"), this, &ANeonVehicle::MoveForward);
	In->BindAxis(TEXT("MoveRight"), this, &ANeonVehicle::MoveRight);
	In->BindAxis(TEXT("Turn"), this, &ANeonVehicle::Turn);
	In->BindAxis(TEXT("LookUp"), this, &ANeonVehicle::LookUp);
	In->BindAction(TEXT("Handbrake"), IE_Pressed, this, &ANeonVehicle::HandbrakeOn);
	In->BindAction(TEXT("Handbrake"), IE_Released, this, &ANeonVehicle::HandbrakeOff);
	In->BindAction(TEXT("Headlights"), IE_Pressed, this, &ANeonVehicle::ToggleHeadlights);
	In->BindAction(TEXT("Horn"), IE_Pressed, this, &ANeonVehicle::Horn);
	In->BindAction(TEXT("Refuel"), IE_Pressed, this, &ANeonVehicle::RefuelOn);
	In->BindAction(TEXT("Refuel"), IE_Released, this, &ANeonVehicle::RefuelOff);
}

void ANeonVehicle::UnPossessed()
{
	Super::UnPossessed();
	ThrottleIn = SteerIn = 0.f;
	bHandbrake = true;
	bEngineOn = false;
	bRefuelHeld = false;
}

float ANeonVehicle::GetSpeedKmh() const { return Body->GetPhysicsLinearVelocity().Size() * 0.036f; }

bool ANeonVehicle::IsAtGasStation() const
{
	const UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	const FNeonPlace* G = Sim ? Sim->NearestPlace(ENeonPlaceType::GasStation, GetActorLocation(), false) : nullptr;
	return G && FVector::Dist2D(G->Center, GetActorLocation()) < 1300.f && GetSpeedKmh() < 3.f;
}

float ANeonVehicle::Refuel(float Dt)
{
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	ANeonCharacter* D = Driver.Get();
	if (!Sim || !D || !IsAtGasStation() || Fuel >= FuelCapacity) return 0.f;
	const float Litres = FMath::Min3(10.f * Dt, FuelCapacity - Fuel, D->Money / Sim->CityFuelPrice);
	if (Litres <= 0.f) return 0.f;
	Fuel += Litres;
	D->Money -= Litres * Sim->CityFuelPrice;
	if (const FNeonPlace* G = Sim->NearestPlace(ENeonPlaceType::GasStation, GetActorLocation(), false)) Sim->RecordSale(G->Id, Litres * Sim->CityFuelPrice);
	return Litres;
}

void ANeonVehicle::Tick(float Dt)
{
	Super::Tick(Dt);
	const bool bDriven = IsPlayerControlled();
	bEngineOn = bDriven && Health > 0.f && Fuel > 0.f;
	if (bDriven && bRefuelHeld) Refuel(Dt);
	SimulateWheels(Dt);
	UpdateLights();
	if (bDriven) CheckNearMisses(Dt);
	PrevVelocity = Body->GetPhysicsLinearVelocity();
}

void ANeonVehicle::SimulateWheels(float Dt)
{
	UWorld* World = GetWorld();
	const FTransform& T = Body->GetComponentTransform();
	const FVector Up = T.GetUnitAxis(EAxis::Z), Fwd = T.GetUnitAxis(EAxis::X);
	const FVector Vel = Body->GetPhysicsLinearVelocity();
	const float SpeedMs = FVector::DotProduct(Vel, Fwd) / 100.f;
	const UNeonSimSubsystem* Sim = World->GetSubsystem<UNeonSimSubsystem>();
	const float Weather = Sim ? 1.f - 0.35f * Sim->Wetness : 1.f;

	// driver inputs: W accelerates, S brakes then reverses
	float Throttle = 0.f, Brake = 0.f;
	if (ThrottleIn > 0.f) { if (SpeedMs < -0.5f) Brake = ThrottleIn; else Throttle = ThrottleIn; }
	else if (ThrottleIn < 0.f) { if (SpeedMs > 0.5f) Brake = -ThrottleIn; else Throttle = ThrottleIn; }
	if (!bEngineOn) Throttle = 0.f;
	bBraking = Brake > 0.1f;
	const float MaxSteer = MaxSteerDeg / (1.f + FMath::Abs(SpeedMs) / 18.f);
	Steer = FMath::FInterpTo(Steer, SteerIn * MaxSteer, Dt, 6.f);

	// engine: constant-power curve limited at low speed, weaker when damaged
	const float PowerW = EnginePowerKW * 1000.f * (0.35f + 0.65f * FMath::Clamp(Health / 60.f, 0.f, 1.f));
	const float DriveN = Throttle >= 0.f ? Throttle * PowerW / FMath::Max(FMath::Abs(SpeedMs), 3.f) : Throttle * 0.35f * PowerW / FMath::Max(FMath::Abs(SpeedMs), 3.f);
	if (bEngineOn)
	{
		// fuel (accelerated ~3x for gameplay): idle + load
		Fuel = FMath::Max(0.f, Fuel - (0.0006f + FMath::Abs(Throttle) * 0.0045f * EnginePowerKW / 150.f) * 3.f * Dt);
	}

	FCollisionQueryParams Q(SCENE_QUERY_STAT(NeonWheel), false, this);
	if (Driver.IsValid()) Q.AddIgnoredActor(Driver.Get());
	Q.bReturnPhysicalMaterial = false;
	for (int32 i = 0; i < 4; ++i)
	{
		const bool bFront = i < 2;
		const FVector Start = T.TransformPosition(Mounts[i]);
		const FVector End = Start - Up * (RestLength + WheelRadius);
		FHitResult Hit;
		float Compression = 0.f;
		if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Q))
		{
			Compression = (RestLength + WheelRadius) - Hit.Distance;
			const FVector PV = Body->GetPhysicsLinearVelocityAtPoint(Start);
			const float VUp = FVector::DotProduct(PV, Up);
			const float Load = FMath::Max(0.f, SpringRate * Compression - Damping * VUp);
			Body->AddForceAtLocation(Up * Load, Start);

			// tyre: forward/lateral axes of this wheel on the ground plane
			const FVector N = Hit.ImpactNormal;
			FVector WFwd = bFront ? Fwd.RotateAngleAxis(Steer, Up) : Fwd;
			WFwd = FVector::VectorPlaneProject(WFwd, N).GetSafeNormal();
			const FVector WRight = FVector::CrossProduct(N, WFwd).GetSafeNormal();
			const float VLong = FVector::DotProduct(PV, WFwd);
			const float VLat = FVector::DotProduct(PV, WRight);

			float Surface = 1.f;
			if (Hit.GetComponent() && Hit.GetComponent()->ComponentHasTag(TEXT("Grass"))) Surface = 0.6f;
			const float Mu = TyreGrip * Surface * Weather * (bHandbrake && !bFront ? 0.45f : 1.f);
			const float MaxF = Mu * Load; // friction circle scales with load → weight transfer

			float FLong = 0.f;
			if (!bFront) FLong += DriveN * 100.f * 0.5f;                       // rear-wheel drive, N → UE units
			const float BrakeForce = (Brake * 0.95f + (bHandbrake && !bFront ? 1.f : 0.f)) * MaxF;
			if (BrakeForce > 0.f) FLong -= FMath::Sign(VLong) * FMath::Min(BrakeForce, FMath::Abs(VLong) * MassKg * 0.25f / FMath::Max(Dt, 1e-3f));
			FLong -= VLong * 0.12f * Load / 1000.f;                              // rolling resistance
			if (!bEngineOn && Brake == 0.f && FMath::Abs(VLong) < 30.f) FLong -= VLong * MassKg * 0.25f; // parked: hold still
			const float FLat = -VLat * Load * 0.025f;
			FVector F = WFwd * FLong + WRight * FLat;
			if (F.Size() > MaxF) F = F.GetSafeNormal() * MaxF;
			Body->AddForceAtLocation(F, Hit.ImpactPoint);
			WheelSpin[i] += VLong / WheelRadius * Dt;
		}
		// wheel visuals follow the suspension
		const float Drop = RestLength - Compression;
		WheelMeshes[i]->SetRelativeLocation(Mounts[i] - FVector(0, 0, FMath::Clamp(Drop, 0.f, RestLength)));
		WheelMeshes[i]->SetRelativeRotation(FRotator(FMath::RadiansToDegrees(-WheelSpin[i]), bFront ? Steer : 0.f, 90.f));
	}
	// aerodynamic drag
	Body->AddForce(-Vel.GetSafeNormal() * 0.0086f * Vel.SizeSquared());
}

void ANeonVehicle::UpdateLights()
{
	const bool bOn = bHeadlights && !bFrontLightsBroken && Health > 0.f;
	HeadlightL->SetIntensity(bOn ? 9000.f : 0.f);
	HeadlightR->SetIntensity(bOn ? 9000.f : 0.f);
	TailLights->SetIntensity(bBraking ? 600.f : (bHeadlights ? 120.f : 0.f));
}

void ANeonVehicle::Horn()
{
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (!Sim) return;
	FNeonWorldEvent E;
	E.Type = ENeonEventType::Horn;
	E.Location = GetActorLocation();
	E.InstigatorId = NeonNames::Player;
	E.Instigator = this;
	E.Description = FString::Printf(TEXT("A %s honked its horn."), *GetDescription());
	E.SoundDescription = TEXT("a car horn");
	E.Tags = { TEXT("horn"), ColorName.ToLower(), TEXT("car") };
	E.Severity = 0.1f; E.AudibleRadius = 3000.f; E.VisibleRadius = 2500.f;
	Sim->PublishEvent(E);
}

void ANeonVehicle::ApplyDamage(float S, const FVector& WorldPoint)
{
	Health = FMath::Max(0.f, Health - FMath::Pow(FMath::Max(0.f, S - 2.f), 1.2f) * 3.f);
	const FVector Local = GetActorTransform().InverseTransformPosition(WorldPoint);
	if (Local.X > 150.f && S > 6.f) bFrontLightsBroken = true;
	// visible damage: the body sags and the cabin shifts a little
	Chassis->SetRelativeScale3D(Chassis->GetRelativeScale3D() * FVector(1.f - FMath::Min(S, 30.f) * 0.0015f, 1.f, 1.f - FMath::Min(S, 30.f) * 0.001f));
	Cabin->AddRelativeRotation(FRotator(0, 0, FMath::FRandRange(-1.f, 1.f) * FMath::Min(S, 20.f) * 0.15f));
}

void ANeonVehicle::OnBodyHit(UPrimitiveComponent*, AActor* Other, UPrimitiveComponent* OtherComp, FVector, const FHitResult& Hit)
{
	const float Now = GetWorld()->GetTimeSeconds();
	if (Now - LastImpactTime < 0.6f || !Other) return;
	FVector OtherVel = OtherComp ? OtherComp->GetComponentVelocity() : FVector::ZeroVector;
	const float S = FMath::Abs(FVector::DotProduct(PrevVelocity - OtherVel, Hit.ImpactNormal)) / 100.f; // m/s along the impact normal
	if (S < 2.5f) return;
	LastImpactTime = Now;
	ApplyDamage(S, Hit.ImpactPoint);
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (!Sim) return;
	FNeonWorldEvent E;
	E.Location = Hit.ImpactPoint;
	E.Instigator = this;
	E.InstigatorId = IsPlayerControlled() ? NeonNames::Player : OwnerNpcId;
	E.Severity = FMath::Clamp(S / 15.f, 0.2f, 1.f);
	E.AudibleRadius = 2500.f + S * 150.f;
	E.VisibleRadius = 5000.f;
	E.Tags = { ColorName.ToLower(), BodyType.ToLower(), TEXT("car"), TEXT("crash") };
	const FString Where = Sim->PlaceNameAt(Hit.ImpactPoint);
	if (ANeonNPC* NPC = Cast<ANeonNPC>(Other))
	{
		NPC->Knockdown(PrevVelocity * 0.6f + FVector(0, 0, 300));
		E.Type = ENeonEventType::PedestrianHit;
		E.VictimId = NPC->GetNpcId();
		E.Severity = FMath::Clamp(S / 8.f, 0.5f, 1.f);
		E.Description = FString::Printf(TEXT("A %s hit %s %s."), *GetDescription(), *NPC->Identity->FirstName, *Where);
		E.SoundDescription = TEXT("a thud, then someone screaming");
		E.Tags.Add(TEXT("hit")); E.Tags.Add(NPC->Identity->FirstName.ToLower());
	}
	else if (ANeonVehicle* OtherCar = Cast<ANeonVehicle>(Other))
	{
		OtherCar->ApplyDamage(S, Hit.ImpactPoint);
		E.Type = ENeonEventType::VehicleCrash;
		E.VictimId = OtherCar->OwnerNpcId;
		E.Description = FString::Printf(TEXT("A %s crashed into a parked %s %s."), *GetDescription(), *OtherCar->GetDescription(), *Where);
		E.SoundDescription = TEXT("a loud crash of metal");
		E.Tags.Add(OtherCar->ColorName.ToLower()); E.Tags.Add(OtherCar->BodyType.ToLower());
	}
	else
	{
		FString What = TEXT("something");
		if (OtherComp && OtherComp->ComponentHasTag(TEXT("Building"))) What = TEXT("a building");
		else if (OtherComp && OtherComp->ComponentHasTag(TEXT("Lamp"))) What = TEXT("a lamp post");
		else if (OtherComp && OtherComp->ComponentHasTag(TEXT("Tree"))) What = TEXT("a tree");
		else if (OtherComp && OtherComp->ComponentHasTag(TEXT("Ground"))) return; // landing a jump isn't a crash
		E.Type = ENeonEventType::VehicleCrash;
		E.Description = FString::Printf(TEXT("A %s crashed into %s %s."), *GetDescription(), *What, *Where);
		E.SoundDescription = TEXT("a loud crash");
	}
	Sim->PublishEvent(E);
}

void ANeonVehicle::CheckNearMisses(float Dt)
{
	if ((NearMissTimer -= Dt) > 0.f) return;
	NearMissTimer = 0.2f;
	const float Kmh = GetSpeedKmh();
	if (Kmh < 30.f) return;
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	const float Now = GetWorld()->GetTimeSeconds();
	for (ANeonNPC* NPC : Sim->GetNPCs())
	{
		if (NPC->IsIndoors() || NPC->IsKnockedDown()) continue;
		const float D = FVector::Dist2D(NPC->GetActorLocation(), GetActorLocation());
		if (D > 420.f) continue;
		if (float* Cd = NearMissCooldown.Find(NPC->GetNpcId())) if (Now - *Cd < 10.f) continue;
		NearMissCooldown.Add(NPC->GetNpcId(), Now);
		FNeonWorldEvent E;
		E.Type = ENeonEventType::NearMiss;
		E.Location = NPC->GetActorLocation();
		E.Instigator = this; E.InstigatorId = NeonNames::Player; E.VictimId = NPC->GetNpcId();
		E.Severity = FMath::Clamp(Kmh / 90.f, 0.3f, 1.f);
		E.Description = FString::Printf(TEXT("A %s nearly ran %s over at %d km/h %s."), *GetDescription(), *NPC->Identity->FirstName, FMath::RoundToInt(Kmh / 10.f) * 10, *Sim->PlaceNameAt(E.Location));
		E.SoundDescription = TEXT("tyres screeching");
		E.Tags = { ColorName.ToLower(), BodyType.ToLower(), TEXT("car"), TEXT("speeding"), TEXT("nearly"), TEXT("reckless") };
		E.AudibleRadius = 1500.f; E.VisibleRadius = 3000.f;
		Sim->PublishEvent(E);
	}
}
