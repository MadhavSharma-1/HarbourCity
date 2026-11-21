#include "NPC/NeonNPC.h"
#include "NPC/NPCIdentityComponent.h"
#include "NPC/NPCMemoryComponent.h"
#include "NPC/NPCNeedsComponent.h"
#include "NPC/NPCEmotionComponent.h"
#include "NPC/NPCRelationshipComponent.h"
#include "NPC/NPCPerceptionComponent.h"
#include "NPC/NPCScheduleComponent.h"
#include "NPC/NPCDialogueComponent.h"
#include "NPC/NPCDecisionController.h"
#include "AI/NeonMemoryLogic.h"
#include "Core/NeonSimSubsystem.h"
#include "Vehicle/NeonVehicle.h"
#include "ProjectNeon.h"
#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Animation/AnimInstance.h"
#include "Engine/SkeletalMesh.h"
#include "PhysicsEngine/PhysicsAsset.h"
#include "Components/SkeletalMeshComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

ANeonNPC::ANeonNPC()
{
	PrimaryActorTick.bCanEverTick = true;
	Identity = CreateDefaultSubobject<UNPCIdentityComponent>(TEXT("Identity"));
	Memory = CreateDefaultSubobject<UNPCMemoryComponent>(TEXT("Memory"));
	Needs = CreateDefaultSubobject<UNPCNeedsComponent>(TEXT("Needs"));
	Emotion = CreateDefaultSubobject<UNPCEmotionComponent>(TEXT("Emotion"));
	Relationships = CreateDefaultSubobject<UNPCRelationshipComponent>(TEXT("Relationships"));
	Perception = CreateDefaultSubobject<UNPCPerceptionComponent>(TEXT("Perception"));
	Schedule = CreateDefaultSubobject<UNPCScheduleComponent>(TEXT("Schedule"));
	Dialogue = CreateDefaultSubobject<UNPCDialogueComponent>(TEXT("Dialogue"));

	AIControllerClass = ANPCDecisionController::StaticClass();
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
	bUseControllerRotationYaw = false;
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0, 300, 0);
	Move->MaxWalkSpeed = 150.f;
	Move->bUseRVOAvoidance = true;      // local obstacle/crowd avoidance without a nav mesh
	Move->AvoidanceConsiderationRadius = 300.f;

	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cyl(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Sph(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	PlaceholderBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderBody"));
	PlaceholderBody->SetupAttachment(GetCapsuleComponent());
	PlaceholderBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	PlaceholderBody->SetRelativeLocation(FVector(0, 0, -15));
	PlaceholderBody->SetRelativeScale3D(FVector(0.42f, 0.32f, 1.35f));
	PlaceholderHead = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderHead"));
	PlaceholderHead->SetupAttachment(GetCapsuleComponent());
	PlaceholderHead->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	PlaceholderHead->SetRelativeLocation(FVector(0, 0, 70));
	PlaceholderHead->SetRelativeScale3D(FVector(0.24f));
	if (Cyl.Succeeded()) PlaceholderBody->SetStaticMesh(Cyl.Object);
	if (Sph.Succeeded()) PlaceholderHead->SetStaticMesh(Sph.Object);

	// default: the third-person template mannequin, if the project has it (Add Feature > Third Person)
	BodyMeshAsset = TSoftObjectPtr<USkeletalMesh>(FSoftObjectPath(TEXT("/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple.SKM_Quinn_Simple")));
	AnimClass = TSoftClassPtr<UAnimInstance>(FSoftObjectPath(TEXT("/Game/Characters/Mannequins/Animations/ABP_Quinn.ABP_Quinn_C")));
}

FName ANeonNPC::GetNpcId() const { return Identity ? Identity->NpcId : NAME_None; }

void ANeonNPC::ApplyLook()
{
	USkeletalMesh* SK = BodyMeshAsset.LoadSynchronous();
	UClass* Anim = AnimClass.LoadSynchronous();
	if (SK)
	{
		GetMesh()->SetSkeletalMesh(SK);
		GetMesh()->SetRelativeLocationAndRotation(FVector(0, 0, -90), FRotator(0, -90, 0));
		if (Anim) GetMesh()->SetAnimInstanceClass(Anim);
		PlaceholderBody->SetVisibility(false);
		PlaceholderHead->SetVisibility(false);
		const float H = Identity->bFemale ? 0.95f : 1.03f;
		GetMesh()->SetRelativeScale3D(FVector(H));
		return;
	}
	if (UMaterialInterface* Base = PlaceholderBody->GetMaterial(0))
	{
		UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(Base, this);
		M->SetVectorParameterValue(TEXT("Color"), Identity->ClothingColor);
		PlaceholderBody->SetMaterial(0, M);
		UMaterialInstanceDynamic* Skin = UMaterialInstanceDynamic::Create(Base, this);
		Skin->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.75f, 0.55f, 0.42f));
		PlaceholderHead->SetMaterial(0, Skin);
	}
}

void ANeonNPC::BeginPlay()
{
	Super::BeginPlay();
	if (UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>())
	{
		Sim->RegisterNPC(this);
		LastSimHours = Sim->GameHours;
	}
}

void ANeonNPC::EndPlay(const EEndPlayReason::Type Reason)
{
	if (UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>()) Sim->UnregisterNPC(this);
	Super::EndPlay(Reason);
}

void ANeonNPC::SetIndoors(bool bInside, const FVector& ExitLocation)
{
	if (bIndoors == bInside) return;
	bIndoors = bInside;
	SetActorHiddenInGame(bInside);
	SetActorEnableCollision(!bInside);
	GetCharacterMovement()->SetMovementMode(bInside ? MOVE_None : MOVE_Walking);
	if (!bInside && !ExitLocation.IsZero()) SetActorLocation(ExitLocation + FVector(0, 0, 100), false, nullptr, ETeleportType::TeleportPhysics);
}

void ANeonNPC::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (!Sim) return;
	const double Dh = FMath::Max(0.0, Sim->GameHours - LastSimHours);
	LastSimHours = Sim->GameHours;
	Needs->Simulate(Dh, CurrentActivity);
	Emotion->BaselineValence = 0.1f + (Identity->Personality.Friendliness - 0.5f) * 0.3f - Needs->FinancialStress() * 0.45f;
	Emotion->BaselineStress = 0.1f + Needs->FinancialStress() * 0.6f + (1.f - Needs->Energy) * 0.15f;
	Emotion->Decay(Dh);

	const int32 Hour = FMath::FloorToInt(Sim->HourOfDay());
	if (Hour != LastHour) { if (LastHour >= 0) OnNewHour(Hour); LastHour = Hour; }

	if (bKnockedDown)
	{
		KnockdownTimer -= DeltaSeconds;
		if (KnockdownTimer <= 0.f)
		{
			bKnockedDown = false;
			SetActorRotation(FRotator(0, GetActorRotation().Yaw, 0));
			if (GetMesh()->IsSimulatingPhysics())
			{
				GetMesh()->SetSimulatePhysics(false);
				GetMesh()->AttachToComponent(GetCapsuleComponent(), FAttachmentTransformRules::SnapToTargetNotIncludingScale);
				GetMesh()->SetRelativeLocationAndRotation(FVector(0, 0, -90), FRotator(0, -90, 0));
			}
			PlaceholderBody->SetRelativeRotation(FRotator::ZeroRotator);
		}
	}
	if (!bIndoors && SimTier <= 2) CheckOwnedCar();
}

void ANeonNPC::OnNewHour(int32 Hour)
{
	Memory->Consolidate();
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (Hour == 0)
	{
		Needs->PayRent();
		if (Needs->Money < Needs->DailyRent * 3.f)
		{
			Emotion->Stimulate(-0.2f, 0.2f);
			Memory->SetFact(TEXT("money"), TEXT("I'm nearly out of money and rent is due again."), { TEXT("money"), TEXT("rent"), TEXT("broke") }, 0.7f);
		}
	}
	// job hunting can pay off; confidence and time spent help
	if (!Needs->bEmployed && CurrentActivity == ENeonActivity::JobHunt && IsIndoors() && Sim)
	{
		const float Chance = 0.08f + Identity->Personality.Confidence * 0.12f;
		if (FMath::FRand() < Chance)
		{
			TArray<FName> Workplaces;
			for (const FNeonPlace& P : Sim->Places) if ((P.Type == ENeonPlaceType::Work || P.Type == ENeonPlaceType::Cafe || P.Type == ENeonPlaceType::Shop || P.Type == ENeonPlaceType::Restaurant) && P.Id != Identity->WorkPlace) Workplaces.Add(P.Id);
			if (Workplaces.Num() > 0) FindJob(Workplaces[FMath::RandRange(0, Workplaces.Num() - 1)]);
		}
	}
}

void ANeonNPC::OnEventSensed(const FNeonWorldEvent& E, ENeonInfoSource Source, float Distance)
{
	if (Memory->KnowsEvent(E.Id)) return;
	const bool bSelf = E.VictimId == GetNpcId();
	const FNeonPersonality& P = Identity->Personality;
	UNPCMemoryComponent::FParams M;
	M.Type = E.Type;
	M.EventId = E.Id;
	M.Summary = Source == ENeonInfoSource::Observed ? E.Description : E.SoundDescription;
	M.Tags = E.Tags;
	M.Importance = NeonMemoryLogic::ImportanceFor(E.Type, E.Severity, bSelf) * (Source == ENeonInfoSource::Observed ? 1.f : 0.7f);
	M.Confidence = Source == ENeonInfoSource::Observed ? FMath::Lerp(0.95f, 0.7f, FMath::Clamp(Distance / E.VisibleRadius, 0.f, 1.f)) : 0.6f;
	M.Source = Source;
	M.Location = E.Location;
	M.Participants = { E.InstigatorId };
	if (!E.VictimId.IsNone()) M.Participants.Add(E.VictimId);
	if (E.Type == ENeonEventType::Horn) M.ExpiresAt = E.GameTime + 0.5;
	if (M.Summary.IsEmpty()) return;
	Memory->Remember(M);

	// emotional response depends on personality and proximity
	const float Near = 1.f - FMath::Clamp(Distance / FMath::Max(E.AudibleRadius, 1.f), 0.f, 1.f);
	switch (E.Type)
	{
	case ENeonEventType::PedestrianHit:
	case ENeonEventType::VehicleCrash:
		Emotion->Stimulate(-0.25f * E.Severity, 0.5f * Near + 0.2f, E.Severity * (1.f - P.RiskTolerance) * (0.4f + 0.6f * Near), bSelf ? 0.5f : 0.f);
		break;
	case ENeonEventType::VehicleDamaged:
		if (bSelf) Emotion->Stimulate(-0.4f, 0.5f, 0.f, 0.4f + P.Aggression * 0.5f);
		break;
	case ENeonEventType::NearMiss:
		Emotion->Stimulate(-0.2f, 0.6f, bSelf ? 0.6f * (1.f - P.Confidence) + 0.2f : 0.1f, bSelf ? 0.3f + P.Aggression * 0.5f : 0.f);
		if (bSelf) Relationships->Adjust(E.InstigatorId, -0.2f, -0.15f, 0.02f, Memory->Now());
		break;
	case ENeonEventType::Horn:
		Emotion->Stimulate(-0.02f, 0.15f * Near, 0.f, P.Aggression * 0.1f * Near);
		break;
	default: break;
	}
	if (bSelf && E.InstigatorId == NeonNames::Player && (E.Type == ENeonEventType::PedestrianHit || E.Type == ENeonEventType::VehicleDamaged))
		Relationships->Adjust(NeonNames::Player, -0.6f, -0.4f, 0.1f, Memory->Now());
	PendingStimuli.Add({ E, Source, Distance, GetWorld()->GetTimeSeconds() });
	if (PendingStimuli.Num() > 6) PendingStimuli.RemoveAt(0);
}

void ANeonNPC::Knockdown(const FVector& Impulse)
{
	if (bKnockedDown) return;
	bKnockedDown = true;
	KnockdownTimer = 5.f;
	if (GetMesh()->GetSkeletalMeshAsset() && GetMesh()->GetPhysicsAsset())
	{
		// ragdoll
		GetMesh()->SetCollisionProfileName(TEXT("Ragdoll"));
		GetMesh()->SetSimulatePhysics(true);
		GetMesh()->AddImpulse(Impulse, NAME_None, true);
	}
	else
	{
		LaunchCharacter(Impulse * 0.5f + FVector(0, 0, 250), true, true);
		PlaceholderBody->SetRelativeRotation(FRotator(0, 0, 80));
	}
	Emotion->Stimulate(-0.6f, 0.9f, 0.8f, 0.4f);
}

void ANeonNPC::LoseJob(const FString& Reason)
{
	if (!Needs->bEmployed) return;
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	FString Employer = TEXT("work");
	if (Sim) if (const FNeonPlace* W = Sim->FindPlace(Identity->WorkPlace)) Employer = W->DisplayName;
	Needs->bEmployed = false;
	Needs->UnemployedSince = Sim ? Sim->GameHours : 0.0;
	Schedule->OnEmploymentChanged(false);
	Emotion->Stimulate(-0.7f, 0.5f, 0.3f, 0.2f);
	UNPCMemoryComponent::FParams M;
	M.Type = ENeonEventType::JobLost; M.Source = ENeonInfoSource::Self; M.Tier = ENeonMemoryTier::Episodic;
	M.Summary = FString::Printf(TEXT("%s lost their job at %s (%s)."), *Identity->FirstName, *Employer, *Reason);
	M.Tags = { TEXT("job"), TEXT("work"), TEXT("fired"), TEXT("unemployed"), Identity->FirstName.ToLower() };
	M.Importance = 0.95f; M.EventId = FString::Printf(TEXT("joblost:%s:%d"), *GetNpcId().ToString(), Sim ? NeonTime::Day(Sim->GameHours) : 0);
	M.Participants = { GetNpcId() };
	Memory->Remember(M);
	Memory->SetFact(TEXT("employment"), FString::Printf(TEXT("I used to work at %s; now I'm looking for a job."), *Employer), { TEXT("job"), TEXT("work"), TEXT("unemployed") }, 0.8f);
	UE_LOG(LogNeon, Log, TEXT("%s lost their job (%s)"), *Identity->FullName(), *Reason);
	Dialogue->Say(TEXT("I can't believe this... I just lost my job."), 5.f);
}

void ANeonNPC::FindJob(FName NewWorkPlace)
{
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	Identity->WorkPlace = NewWorkPlace;
	Needs->bEmployed = true;
	Needs->UnemployedSince = -1.0;
	Needs->HourlyWage *= FMath::FRandRange(0.85f, 1.1f);
	Schedule->OnEmploymentChanged(true);
	Emotion->Stimulate(0.6f, 0.4f, 0.f, 0.f, 0.6f);
	FString Name = NewWorkPlace.ToString();
	if (Sim) if (const FNeonPlace* W = Sim->FindPlace(NewWorkPlace)) Name = W->DisplayName;
	UNPCMemoryComponent::FParams M;
	M.Type = ENeonEventType::JobFound; M.Source = ENeonInfoSource::Self; M.Tier = ENeonMemoryTier::Episodic;
	M.Summary = FString::Printf(TEXT("%s got a new job at %s."), *Identity->FirstName, *Name);
	M.Tags = { TEXT("job"), TEXT("work"), TEXT("hired"), Identity->FirstName.ToLower() };
	M.Importance = 0.85f; M.Participants = { GetNpcId() };
	Memory->Remember(M);
	Memory->SetFact(TEXT("employment"), FString::Printf(TEXT("I work at %s."), *Name), { TEXT("job"), TEXT("work") }, 0.6f);
	UE_LOG(LogNeon, Log, TEXT("%s found a job at %s"), *Identity->FullName(), *Name);
}

void ANeonNPC::CheckOwnedCar()
{
	ANeonVehicle* Car = OwnedVehicle.Get();
	if (!Car) return;
	if (Car->Health >= LastSeenCarHealth - 1.f) { LastSeenCarHealth = FMath::Min(LastSeenCarHealth, Car->Health); return; }
	if (!Perception->CanSee(Car->GetActorLocation(), Car, 2500.f)) return;
	// they notice the damage when they next see their car
	const float Drop = LastSeenCarHealth - Car->Health;
	LastSeenCarHealth = Car->Health;
	const bool bAlreadyKnew = Memory->Memories.ContainsByPredicate([&](const FNeonMemory& M) { return M.EventType == ENeonEventType::VehicleDamaged && M.Participants.Contains(GetNpcId()) && Memory->Now() - M.GameTime < 6.0; });
	UNPCMemoryComponent::FParams M;
	M.Type = ENeonEventType::VehicleDamaged; M.Source = ENeonInfoSource::Observed;
	M.Summary = FString::Printf(TEXT("Found my %s damaged."), *Car->GetDescription());
	M.Tags = { TEXT("my"), TEXT("car"), TEXT("damaged"), TEXT("dent"), Car->ColorName.ToLower() };
	M.Importance = FMath::Clamp(0.5f + Drop / 100.f, 0.f, 1.f); M.Participants = { GetNpcId() }; M.Location = Car->GetActorLocation();
	Memory->Remember(M);
	if (!bAlreadyKnew)
	{
		Emotion->Stimulate(-0.4f, 0.5f, 0.f, 0.3f + Identity->Personality.Aggression * 0.5f);
		Dialogue->Say(Identity->Personality.Aggression > 0.5f ? TEXT("Who did this to my car?!") : TEXT("Oh no... my car."), 4.f);
	}
}
