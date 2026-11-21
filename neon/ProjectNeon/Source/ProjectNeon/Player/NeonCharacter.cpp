#include "Player/NeonCharacter.h"
#include "World/NeonMaterials.h"
#include "Camera/CameraComponent.h"
#include "Components/InputComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "UObject/ConstructorHelpers.h"

ANeonCharacter::ANeonCharacter()
{
	bUseControllerRotationYaw = false;
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0, 540, 0);
	Move->MaxWalkSpeed = 260.f;
	Move->JumpZVelocity = 420.f;
	Move->BrakingDecelerationWalking = 1600.f;

	CameraArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraArm"));
	CameraArm->SetupAttachment(RootComponent);
	CameraArm->TargetArmLength = 320.f;
	CameraArm->SocketOffset = FVector(0, 55, 60);
	CameraArm->bUsePawnControlRotation = true;
	CameraArm->bEnableCameraLag = true;
	CameraArm->CameraLagSpeed = 14.f;
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(CameraArm);

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

	BodyMeshAsset = TSoftObjectPtr<USkeletalMesh>(FSoftObjectPath(TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple.SKM_Manny_Simple")));
	AnimClass = TSoftClassPtr<UAnimInstance>(FSoftObjectPath(TEXT("/Game/Characters/Mannequins/Animations/ABP_Manny.ABP_Manny_C")));
}

void ANeonCharacter::BeginPlay()
{
	Super::BeginPlay();
	if (USkeletalMesh* SK = BodyMeshAsset.LoadSynchronous())
	{
		GetMesh()->SetSkeletalMesh(SK);
		GetMesh()->SetRelativeLocationAndRotation(FVector(0, 0, -90), FRotator(0, -90, 0));
		if (UClass* A = AnimClass.LoadSynchronous()) GetMesh()->SetAnimInstanceClass(A);
		PlaceholderBody->SetVisibility(false);
		PlaceholderHead->SetVisibility(false);
	}
	else
	{
		PlaceholderBody->SetMaterial(0, NeonMaterials::Surface(this, FLinearColor(0.03f, 0.03f, 0.035f), 0.4f));
		PlaceholderHead->SetMaterial(0, NeonMaterials::Surface(this, FLinearColor(0.45f, 0.3f, 0.22f), 0.5f));
	}
}

void ANeonCharacter::SetupPlayerInputComponent(UInputComponent* In)
{
	Super::SetupPlayerInputComponent(In);
	In->BindAxis(TEXT("MoveForward"), this, &ANeonCharacter::MoveForward);
	In->BindAxis(TEXT("MoveRight"), this, &ANeonCharacter::MoveRight);
	In->BindAxis(TEXT("Turn"), this, &APawn::AddControllerYawInput);
	In->BindAxis(TEXT("LookUp"), this, &APawn::AddControllerPitchInput);
	In->BindAction(TEXT("Jump"), IE_Pressed, this, &ACharacter::Jump);
	In->BindAction(TEXT("Jump"), IE_Released, this, &ACharacter::StopJumping);
	In->BindAction(TEXT("Sprint"), IE_Pressed, this, &ANeonCharacter::SprintOn);
	In->BindAction(TEXT("Sprint"), IE_Released, this, &ANeonCharacter::SprintOff);
}

void ANeonCharacter::MoveForward(float V)
{
	if (!Controller || V == 0.f) return;
	const FRotator Yaw(0, Controller->GetControlRotation().Yaw, 0);
	AddMovementInput(FRotationMatrix(Yaw).GetUnitAxis(EAxis::X), V);
}

void ANeonCharacter::MoveRight(float V)
{
	if (!Controller || V == 0.f) return;
	const FRotator Yaw(0, Controller->GetControlRotation().Yaw, 0);
	AddMovementInput(FRotationMatrix(Yaw).GetUnitAxis(EAxis::Y), V);
}

void ANeonCharacter::SprintOn() { GetCharacterMovement()->MaxWalkSpeed = 600.f; }
void ANeonCharacter::SprintOff() { GetCharacterMovement()->MaxWalkSpeed = 260.f; }
