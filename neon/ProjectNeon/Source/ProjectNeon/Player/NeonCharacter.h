#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "NeonCharacter.generated.h"

class USpringArmComponent;
class UCameraComponent;
class UStaticMeshComponent;
class USkeletalMesh;
class UAnimInstance;

/** Third-person player character. */
UCLASS()
class PROJECTNEON_API ANeonCharacter : public ACharacter
{
	GENERATED_BODY()
public:
	ANeonCharacter();

	UPROPERTY(VisibleAnywhere) USpringArmComponent* CameraArm;
	UPROPERTY(VisibleAnywhere) UCameraComponent* Camera;
	UPROPERTY(VisibleAnywhere) UStaticMeshComponent* PlaceholderBody;
	UPROPERTY(VisibleAnywhere) UStaticMeshComponent* PlaceholderHead;

	/** What witnesses would remember about you. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Appearance = TEXT("a person in a dark leather jacket and red trousers");
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Money = 350.f;

	UPROPERTY(EditDefaultsOnly, Category = "Neon|Look") TSoftObjectPtr<USkeletalMesh> BodyMeshAsset;
	UPROPERTY(EditDefaultsOnly, Category = "Neon|Look") TSoftClassPtr<UAnimInstance> AnimClass;

	virtual void BeginPlay() override;
	virtual void SetupPlayerInputComponent(UInputComponent* Input) override;

private:
	void MoveForward(float V);
	void MoveRight(float V);
	void SprintOn();
	void SprintOff();
};
