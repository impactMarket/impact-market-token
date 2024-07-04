//SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/DonationMinerStorageV5.sol";

contract DonationMinerImplementation is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    DonationMinerStorageV5
{
    address internal constant AIRDROP_V3_TOKEN_ADDRESS = 0x00000000000000000000000000000000000000A3;
    address internal constant MICROCREDIT_TOKEN_ADDRESS =
        0x00000000000000000000000000000000000000C1;

    using SafeERC20Upgradeable for IERC20;

    /**
     * @notice Triggered when a donation has been added
     *
     * @param donationId        Id of the donation
     * @param delegateAddress   Address of the delegate
     * @param amount            Value of the donation
     * @param token             Address of the token after conversion
     * @param amount            Number of token donated
     * @param target            Address of the receiver (community or treasury)
     *                          or address of the DonationMiner contract otherwise
     */
    event DonationAdded(
        uint256 indexed donationId,
        address indexed delegateAddress,
        uint256 amount,
        address token,
        uint256 initialAmount,
        address indexed target
    );

    /**
     * @notice Triggered when a donor has claimed his reward
     *
     * @param donor             Address of the donner
     * @param amount            Value of the reward
     */
    event RewardClaimed(address indexed donor, uint256 amount);

    /**
     * @notice Triggered when a donor has claimed his reward
     *
     * @param donor             Address of the donner
     * @param amount            Value of the reward
     * @param lastRewardPeriod  Number of the last reward period for witch the claim was made
     */
    event RewardClaimedPartial(address indexed donor, uint256 amount, uint256 lastRewardPeriod);

    /**
     * @notice Triggered when a donor has staked his reward
     *
     * @param donor             Address of the donner
     * @param amount            Value of the reward
     */
    event RewardStaked(address indexed donor, uint256 amount);

    /**
     * @notice Triggered when a donor has staked his reward
     *
     * @param donor             Address of the donner
     * @param amount            Value of the reward
     * @param lastRewardPeriod  Number of the last reward period for witch tha stake was made
     */
    event RewardStakedPartial(address indexed donor, uint256 amount, uint256 lastRewardPeriod);

    /**
     * @notice Triggered when an amount of an ERC20 has been transferred from this contract to an address
     *
     * @param token               ERC20 token address
     * @param to                  Address of the receiver
     * @param amount              Amount of the transaction
     */
    event TransferERC20(address indexed token, address indexed to, uint256 amount);

    /**
     * @notice Triggered when reward period params have been updated
     *
     * @param oldRewardPeriodSize   Old rewardPeriodSize value
     * @param oldDecayNumerator     Old decayNumerator value
     * @param oldDecayDenominator   Old decayDenominator value
     * @param newRewardPeriodSize   New rewardPeriodSize value
     * @param newDecayNumerator     New decayNumerator value
     * @param newDecayDenominator   New decayDenominator value
     *
     * For further information regarding each parameter, see
     * *DonationMiner* smart contract initialize method.
     */
    event RewardPeriodParamsUpdated(
        uint256 oldRewardPeriodSize,
        uint256 oldDecayNumerator,
        uint256 oldDecayDenominator,
        uint256 newRewardPeriodSize,
        uint256 newDecayNumerator,
        uint256 newDecayDenominator
    );

    /**
     * @notice Triggered when the claimDelay value has been updated
     *
     * @param oldClaimDelay            Old claimDelay value
     * @param newClaimDelay            New claimDelay value
     */
    event ClaimDelayUpdated(uint256 oldClaimDelay, uint256 newClaimDelay);

    /**
     * @notice Triggered when the stakingDonationRatio value has been updated
     *
     * @param oldStakingDonationRatio            Old stakingDonationRatio value
     * @param newStakingDonationRatio            New stakingDonationRatio value
     */
    event StakingDonationRatioUpdated(
        uint256 oldStakingDonationRatio,
        uint256 newStakingDonationRatio
    );

    /**
     * @notice Triggered when the communityDonationRatio value has been updated
     *
     * @param oldCommunityDonationRatio            Old communityDonationRatio value
     * @param newCommunityDonationRatio            New communityDonationRatio value
     */
    event CommunityDonationRatioUpdated(
        uint256 oldCommunityDonationRatio,
        uint256 newCommunityDonationRatio
    );

    /**
     * @notice Triggered when the againstPeriods value has been updated
     *
     * @param oldAgainstPeriods            Old againstPeriods value
     * @param newAgainstPeriods            New againstPeriods value
     */
    event AgainstPeriodsUpdated(uint256 oldAgainstPeriods, uint256 newAgainstPeriods);

    /**
     * @notice Triggered when the treasury address has been updated
     *
     * @param oldTreasury             Old treasury address
     * @param newTreasury             New treasury address
     */
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /**
     * @notice Triggered when the staking address has been updated
     *
     * @param oldStaking             Old staking address
     * @param newStaking             New staking address
     */
    event StakingUpdated(address indexed oldStaking, address indexed newStaking);

    /**
     * @notice Enforces beginning rewardPeriod has started
     */
    modifier whenStarted() {
        require(block.number >= rewardPeriods[1].startBlock, "DonationMiner: ERR_NOT_STARTED");
        _;
    }

    /**
     * @notice Enforces sender to be Staking contract
     */
    modifier onlyStaking() {
        require(msg.sender == address(staking), "DonationMiner: NOT_STAKING");
        _;
    }

    /**
     * @notice Enforces sender to be Staking contract
     */
    modifier onlyRecurringCron() {
        require(msg.sender == recurringCronAddress, "DonationMiner: You are not allow to call this method");
        _;
    }

    /**
     * @notice Used to initialize a new DonationMiner contract
     *
     * @param _cUSD                 Address of the cUSD token
     * @param _PACT                 Address of the PACT Token
     * @param _treasury             Address of the Treasury
     * @param _firstRewardPerBlock  Number of PACTs given for each block
     *                              from the first reward period
     * @param _rewardPeriodSize     Number of blocks of the reward period
     * @param _startingBlock        First block of the first reward period
     * @param _decayNumerator       Decay numerator used for calculating
                                    the new reward per block based on
                                    the previous reward per block
     * @param _decayDenominator     Decay denominator used for calculating
                                    the new reward per block based on
                                    the previous reward per block
     */
    function initialize(
        IERC20 _cUSD,
        IERC20 _PACT,
        ITreasury _treasury,
        uint256 _firstRewardPerBlock,
        uint256 _rewardPeriodSize,
        uint256 _startingBlock,
        uint256 _decayNumerator,
        uint256 _decayDenominator
    ) public initializer {
        require(address(_cUSD) != address(0), "DonationMiner::initialize: cUSD address not set");
        require(address(_PACT) != address(0), "DonationMiner::initialize: PACT address not set");
        require(address(_treasury) != address(0), "DonationMiner::initialize: treasury_ not set");
        require(
            _firstRewardPerBlock != 0,
            "DonationMiner::initialize: firstRewardPerBlock not set!"
        );
        require(_startingBlock != 0, "DonationMiner::initialize: startingRewardPeriod not set!");
        require(_rewardPeriodSize != 0, "DonationMiner::initialize: rewardPeriodSize is invalid!");

        __Ownable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        cUSD = _cUSD;
        PACT = _PACT;
        treasury = _treasury;
        rewardPeriodSize = _rewardPeriodSize;
        decayNumerator = _decayNumerator;
        decayDenominator = _decayDenominator;

        rewardPeriodCount = 1;
        initFirstPeriod(_startingBlock, _firstRewardPerBlock);
    }

    /**
     * @notice Returns the current implementation version
     */
    function getVersion() external pure override returns (uint256) {
        return 5;
    }

    /**
     * @notice Returns the amount of cUSD donated by a user in a reward period
     *
     * @param _period number of the reward period
     * @param _donor address of the donor
     * @return uint256 amount of cUSD donated by the user in this reward period
     */
    function rewardPeriodDonorAmount(uint256 _period, address _donor)
        external
        view
        override
        returns (uint256)
    {
        return rewardPeriods[_period].donorAmounts[_donor];
    }

    /**
     * @notice Returns the amount of PACT staked by a user at the and of the reward period
     *
     * @param _period reward period number
     * @param _donor address of the donor
     * @return uint256 amount of PACT staked by a user at the and of the reward period
     */
    function rewardPeriodDonorStakeAmounts(uint256 _period, address _donor)
        external
        view
        override
        returns (uint256)
    {
        return rewardPeriods[_period].donorStakeAmounts[_donor];
    }

    /**
     * @notice Returns a reward period number from a donor reward period list
     *
     * @param _donor address of the donor
     * @param _rewardPeriodIndex index of the reward period
     * @return uint256 number of the reward period
     */
    function donorRewardPeriod(address _donor, uint256 _rewardPeriodIndex)
        external
        view
        override
        returns (uint256)
    {
        return donors[_donor].rewardPeriods[_rewardPeriodIndex];
    }

    /**
     * @notice Updates reward period default params
     *
     * @param _newRewardPeriodSize value of new rewardPeriodSize
     * @param _newDecayNumerator value of new decayNumerator
     * @param _newDecayDenominator value of new decayDenominator
     */
    function updateRewardPeriodParams(
        uint256 _newRewardPeriodSize,
        uint256 _newDecayNumerator,
        uint256 _newDecayDenominator
    ) external override onlyOwner {
        require(
            _newRewardPeriodSize != 0,
            "DonationMiner::initialize: rewardPeriodSize is invalid!"
        );

        initializeRewardPeriods();

        emit RewardPeriodParamsUpdated(
            rewardPeriodSize,
            decayNumerator,
            decayDenominator,
            _newRewardPeriodSize,
            _newDecayNumerator,
            _newDecayDenominator
        );

        rewardPeriodSize = _newRewardPeriodSize;
        decayNumerator = _newDecayNumerator;
        decayDenominator = _newDecayDenominator;
    }

    /**
     * @notice Updates claimDelay value
     *
     * @param _newClaimDelay      Number of reward periods a donor has to wait after
     *                            a donation until he will be able to claim his reward
     */
    function updateClaimDelay(uint256 _newClaimDelay) external override onlyOwner {
        emit ClaimDelayUpdated(claimDelay, _newClaimDelay);

        claimDelay = _newClaimDelay;
    }

    /**
     * @notice Updates stakingDonationRatio value
     *
     * @param _newStakingDonationRatio    Number of tokens that need to be staked to be counted as 1 PACT donated
     */
    function updateStakingDonationRatio(uint256 _newStakingDonationRatio)
        external
        override
        onlyOwner
    {
        initializeRewardPeriods();

        emit StakingDonationRatioUpdated(stakingDonationRatio, _newStakingDonationRatio);

        stakingDonationRatio = _newStakingDonationRatio;
    }

    /**
     * @notice Updates communityDonationRatio value
     *
     * @param _newCommunityDonationRatio    Ratio between 1USD donated into the treasury vs 1USD donated to a community
     */
    function updateCommunityDonationRatio(uint256 _newCommunityDonationRatio)
        external
        override
        onlyOwner
    {
        emit CommunityDonationRatioUpdated(communityDonationRatio, _newCommunityDonationRatio);
        communityDonationRatio = _newCommunityDonationRatio;
    }

    /**
     * @notice Updates againstPeriods value
     *
     * @param _newAgainstPeriods      Number of reward periods for the backward computation
     */
    function updateAgainstPeriods(uint256 _newAgainstPeriods) external override onlyOwner {
        initializeRewardPeriods();

        emit AgainstPeriodsUpdated(againstPeriods, _newAgainstPeriods);
        againstPeriods = _newAgainstPeriods;
    }

    /**
     * @notice Updates Treasury address
     *
     * @param _newTreasury address of new treasury_ contract
     */
    function updateTreasury(ITreasury _newTreasury) external override onlyOwner {
        emit TreasuryUpdated(address(treasury), address(_newTreasury));
        treasury = _newTreasury;
    }

    /**
     * @notice Updates Staking address
     *
     * @param _newStaking address of new Staking contract
     */
    function updateStaking(IStaking _newStaking) external override onlyOwner {
        emit StakingUpdated(address(staking), address(_newStaking));
        staking = _newStaking;
    }

    /**
     * @notice Updates AirdropV3 address
     *
     * @param _newAirdropV3 address of new AirdropV3 contract
     */
    function updateAirdropV3(IAirdropV3 _newAirdropV3) external override onlyOwner {
        airdropV3 = _newAirdropV3;
    }

    /**
     * @notice Updates Microcredit address
     *
     * @param _newMicrocredit address of new Microcredit contract
     */
    function updateMicrocredit(IMicrocredit _newMicrocredit) external override onlyOwner {
        microcredit = _newMicrocredit;
    }

    /**
     * @notice Updates recurring cron address address
     *
     * @param _newRecurringCronAddress  new address of recurring cron
     */
    function updateRecurringCronAddress(address _newRecurringCronAddress) external override onlyOwner {
        recurringCronAddress = _newRecurringCronAddress;
    }

    /**
     * @notice Transfers tokens to the treasury contract
     *
     * @param _token address of the token
     * @param _amount Amount of tokens to deposit.
     * @param _delegateAddress the address that will claim the reward for the donation
     */
    function donate(
        IERC20 _token,
        uint256 _amount,
        address _delegateAddress
    ) external override whenNotPaused whenStarted nonReentrant {
        require(treasury.isToken(address(_token)), "DonationMiner::donate: Invalid token");

        _token.safeTransferFrom(msg.sender, address(treasury), _amount);

        _addDonation(_delegateAddress, _token, _amount, address(treasury));
    }

    /**
     * @notice Transfers tokens from the _from to the treasury contract
     *
     * @param _from address of the user
     * @param _token address of the token
     * @param _amount Amount of tokens to deposit.
     * @param _delegateAddress the address that will claim the reward for the donation
     */
    function donateFrom(
        address _from,
        IERC20 _token,
        uint256 _amount,
        address _delegateAddress
    ) external override onlyRecurringCron whenNotPaused whenStarted nonReentrant {
        require(
            treasury.isToken(address(_token)), "DonationMiner: Invalid token");

        _token.safeTransferFrom(_from, address(treasury), _amount);

        _addDonation(_delegateAddress, _token, _amount, address(treasury));
    }

    /**
     * @dev Transfers tokens to the community contract
     *
     * @param _community address of the community
     * @param _token address of the token
     * @param _amount amount of tokens to deposit
     * @param _delegateAddress the address that will claim the reward for the donation
     */
    function donateToCommunity(
        ICommunity _community,
        IERC20 _token,
        uint256 _amount,
        address _delegateAddress
    ) external override whenNotPaused whenStarted nonReentrant {
        ICommunityAdmin _communityAdmin = treasury.communityAdmin();
        require(
            _communityAdmin.communities(address(_community)) ==
                ICommunityAdmin.CommunityState.Valid,
            "DonationMiner::donateToCommunity: This is not a valid community address"
        );

        require(
            address(_token) == address(_community.cUSD()),
            "DonationMiner::donateToCommunity: Invalid token"
        );

        _community.donate(msg.sender, _amount);
        _addDonation(_delegateAddress, _token, _amount, address(_community));
    }

    /**
     * @notice Virtual donate tokens to the treasury contract
     *
     * @param _amount Amount of tokens to fake deposit.
     * @param _delegateAddress the address that will claim the reward for the donation
     */
    function donateVirtual(uint256 _amount, address _delegateAddress)
        external
        override
        whenNotPaused
    {
        if (msg.sender == address(airdropV3)) {
            _addDonation(
                _delegateAddress,
                IERC20(AIRDROP_V3_TOKEN_ADDRESS),
                _amount,
                address(treasury)
            );
        } else if (msg.sender == address(microcredit)) {
            _addDonation(
                _delegateAddress,
                IERC20(MICROCREDIT_TOKEN_ADDRESS),
                _amount,
                address(treasury)
            );
        } else {
            revert("DonationMiner: You are not allow to call this method");
        }
    }

    /**
     * @notice Virtual donate tokens to the treasury contract
     *
     * @param _amount Amount of tokens to fake deposit.
     * @param _delegateAddress the address that will claim the reward for the donation
     */
    function addPoints(uint256 _amount, address _delegateAddress)
    external
    {
        require (msg.sender == address(0xd6343CaA056bA88102754e165A4E463017FAac8C), 'DonationMiner: Invalid caller');
        _addDonation(
            _delegateAddress,
            IERC20(MICROCREDIT_TOKEN_ADDRESS),
            _amount,
            address(treasury)
        );
    }

    /**
     * @notice Transfers to the sender the rewards
     */
    function claimRewards() external override whenNotPaused whenStarted nonReentrant {
        uint256 _claimAmount = _computeRewardsByPeriodNumber(msg.sender, _getLastClaimablePeriod());

        IERC20Upgradeable(address(PACT)).safeTransfer(msg.sender, _claimAmount);
        emit RewardClaimed(msg.sender, _claimAmount);
    }

    /**
     * @notice Transfers to the sender the rewards
     */
    function claimRewardsPartial(uint256 _lastPeriodNumber)
        external
        override
        whenNotPaused
        whenStarted
        nonReentrant
    {
        require(
            _lastPeriodNumber <= _getLastClaimablePeriod(),
            "DonationMiner::claimRewardsPartial: This reward period isn't claimable yet"
        );

        uint256 _claimAmount = _computeRewardsByPeriodNumber(msg.sender, _lastPeriodNumber);

        IERC20Upgradeable(address(PACT)).safeTransfer(msg.sender, _claimAmount);

        emit RewardClaimedPartial(msg.sender, _claimAmount, _lastPeriodNumber);
    }

    /**
     * @notice Stakes the reward
     */
    function stakeRewards() external override whenNotPaused whenStarted nonReentrant {
        initializeRewardPeriods();

        uint256 _stakeAmount = _computeRewardsByPeriodNumber(msg.sender, rewardPeriodCount - 1);

        PACT.approve(address(staking), _stakeAmount);
        staking.stake(msg.sender, _stakeAmount);

        emit RewardStaked(msg.sender, _stakeAmount);
    }

    /**
     * @notice Stakes the reward
     */
    function stakeRewardsPartial(uint256 _lastPeriodNumber)
        external
        override
        whenNotPaused
        whenStarted
        nonReentrant
    {
        initializeRewardPeriods();

        require(
            _lastPeriodNumber < rewardPeriodCount,
            "DonationMiner::stakeRewardsPartial: This reward period isn't claimable yet"
        );

        uint256 _stakeAmount = _computeRewardsByPeriodNumber(msg.sender, _lastPeriodNumber);

        PACT.approve(address(staking), _stakeAmount);
        staking.stake(msg.sender, _stakeAmount);

        emit RewardStaked(msg.sender, _stakeAmount);
    }

    /**
     * @notice Calculates the rewards from ended reward periods of a donor
     *
     * @param _donorAddress address of the donor
     * @param _lastPeriodNumber last reward period number to be computed
     * @return uint256 sum of all donor's rewards that has not been claimed until _lastPeriodNumber
     */
    function calculateClaimableRewardsByPeriodNumber(
        address _donorAddress,
        uint256 _lastPeriodNumber
    ) external view override returns (uint256) {
        uint256 _maxRewardPeriod;

        if (rewardPeriods[rewardPeriodCount].endBlock < block.number) {
            _maxRewardPeriod =
                (block.number - rewardPeriods[rewardPeriodCount].endBlock) /
                rewardPeriodSize;
            _maxRewardPeriod += rewardPeriodCount;
        } else {
            _maxRewardPeriod = rewardPeriodCount - 1;
        }

        require(
            _lastPeriodNumber <= _maxRewardPeriod,
            "DonationMiner::calculateClaimableRewardsByPeriodNumber: This reward period isn't available yet"
        );

        (uint256 _claimAmount, ) = _calculateRewardByPeriodNumber(_donorAddress, _lastPeriodNumber);
        return _claimAmount;
    }

    /**
     * @notice Calculates the rewards from ended reward periods of a donor
     *
     * @param _donorAddress address of the donor
     * @return claimAmount uint256 sum of all donor's rewards that has not been claimed until _lastPeriodNumber
     */
    function calculateClaimableRewards(address _donorAddress)
        external
        view
        override
        returns (uint256)
    {
        (uint256 _claimAmount, ) = _calculateRewardByPeriodNumber(
            _donorAddress,
            currentRewardPeriodNumber() - 1
        );
        return _claimAmount;
    }

    /**
     * @notice Calculates the estimate reward of a donor for current reward period
     *
     * @param _donorAddress             address of the donor
     *
     * @return uint256 reward that donor will receive in current reward period if there isn't another donation
     */
    function estimateClaimableReward(address _donorAddress)
        external
        view
        override
        returns (uint256)
    {
        return _estimateDonorClaimableReward(_donorAddress, 0);
    }

    /**
     * @notice Calculates the estimate reward of a donor for the next x reward periods
     *
     * @param _donorAddress             address of the donor
     *
     * @return uint256 the estimate reward donor will receive after against periods based on the current donations and stakings
     */
    function estimateClaimableRewardAdvance(address _donorAddress)
        external
        view
        override
        returns (uint256)
    {
        return _estimateDonorClaimableReward(_donorAddress, againstPeriods);
    }

    /**
     * @notice Calculates the estimate reward of a possible new donation  for the next againstPeriods reward periods
     *
     * @param _donationAmount             amount of the donation
     *
     * @return uint256 the estimate reward donor will receive after against periods based on the current donations and stakings
     */
    function estimateNewDonationClaimableRewardAdvance(uint256 _donationAmount)
        external
        view
        override
        returns (uint256)
    {
        return _estimateNewDonationClaimableReward(_donationAmount, againstPeriods);
    }

    /**
     * @notice Calculates the estimate reward of a donor for current reward period based on his staking
     *
     * @return uint256 estimated reward by donor stakes
     */
    function estimateClaimableRewardByStaking(address _donorAddress)
        external
        view
        override
        returns (uint256)
    {
        uint256 _donorAmount;
        uint256 _totalAmount;

        (, _totalAmount) = lastPeriodsDonations(address(0));

        uint256 _currentPeriodReward = _calculateCurrentPeriodReward();

        return
            (_currentPeriodReward * staking.stakeholderAmount(_donorAddress)) /
            (_totalAmount * stakingDonationRatio + staking.currentTotalAmount());
    }

    /**
     * @notice Calculates the APR of a user based on his staking
     *
     * @param _stakeholderAddress      address of the stakeHolder
     *
     * @return uint256 APR of the user
     */
    function apr(address _stakeholderAddress)
        external
        view
        override
        returns (uint256)
    {
        uint256 _stakeholderAmount = staking.stakeholderAmount(_stakeholderAddress);
        if (_stakeholderAmount == 0) {
            return 0;
        }

        return
            (1e18 * 365100 * _estimateDonorClaimableReward(_stakeholderAddress, 0)) / _stakeholderAmount;
    }

    /**
     * @notice Calculates the APR
     *
     * @return uint256 APR
     */
    function generalApr() public view override returns (uint256) {
        uint256 _donorAmount;
        uint256 _totalAmount;

        (, _totalAmount) = lastPeriodsDonations(address(0));

        uint256 _currentPeriodReward = _calculateCurrentPeriodReward();
        uint256 _totalReward = _currentPeriodReward;
        uint256 _index;
        while (_index < 364) {
            _currentPeriodReward = (_currentPeriodReward * decayNumerator) / decayDenominator;
            _totalReward += _currentPeriodReward;
            _index++;
        }

        return
            (1e18 * 100 * _totalReward) /
            (_totalAmount * stakingDonationRatio + staking.currentTotalAmount());
    }

    /**
     * @dev Calculate the score of a user based as
     * this ratio (his donation and staking) / (all donation and staking)
     * E.G. score = 0.01 * 1e18 => the donor have have 1% score
     *      so he will get 1% of the reward
     *
     * @param _donorAddress  address of the donor
     *
     * @return uint256    donor's score
     */
    function donorScore(address _donorAddress) public view returns (uint256) {
        return _calculateDonorShare(_donorAddress, 1e18);
    }

    /**
     * @dev Calculate all donations on the last X epochs as well as everyone else in the same period.
     *
     * @param _donorAddress  address of the donor
     *
     * @return donorAmount uint256    sum of donor's donations
     * @return totalAmount uint256    sum of all donations
     */
    function lastPeriodsDonations(address _donorAddress)
        public
        view
        override
        returns (uint256 donorAmount, uint256 totalAmount)
    {
        uint256 _currentRewardPeriodNumber = currentRewardPeriodNumber();

        uint256 _startPeriod = _currentRewardPeriodNumber > againstPeriods
            ? _currentRewardPeriodNumber - againstPeriods
            : 1;

        if (rewardPeriodCount >= _startPeriod) {
            (donorAmount, totalAmount) = _calculateDonorIntervalAmounts(
                _donorAddress,
                _startPeriod,
                rewardPeriodCount
            );
        }
    }

    /**
     * @notice Transfers an amount of an ERC20 from this contract to an address
     *
     * @param _token address of the ERC20 token
     * @param _to address of the receiver
     * @param _amount amount of the transaction
     */
    function transfer(
        IERC20 _token,
        address _to,
        uint256 _amount
    ) external override onlyOwner nonReentrant {
        IERC20Upgradeable(address(_token)).safeTransfer(_to, _amount);

        emit TransferERC20(address(_token), _to, _amount);
    }

    function setStakingAmounts(
        address _holderAddress,
        uint256 _holderAmount,
        uint256 _totalAmount
    ) external override whenNotPaused whenStarted onlyStaking {
        initializeRewardPeriods();

        RewardPeriod storage _rewardPeriod = rewardPeriods[rewardPeriodCount];
        _rewardPeriod.hasSetStakeAmount[_holderAddress] = true;
        _rewardPeriod.donorStakeAmounts[_holderAddress] = _holderAmount;
        _rewardPeriod.stakesAmount = _totalAmount;

        Donor storage _donor = donors[_holderAddress];
        //if user hasn't made any donation/staking
        //set _donor.lastClaimPeriod to be previous reward period
        //to not calculate reward for epochs 1 to rewardPeriodsCount -1
        if (_donor.lastClaimPeriod == 0 && _donor.rewardPeriodsCount == 0) {
            _donor.lastClaimPeriod = rewardPeriodCount - 1;
        }

        treasury.useFundsForLP();
    }

    function currentRewardPeriodNumber() public view override returns (uint256) {
        uint256 lastRewardPeriodEndBlock = rewardPeriods[rewardPeriodCount].endBlock;

        return
            lastRewardPeriodEndBlock > block.number
                ? rewardPeriodCount
                : rewardPeriodCount +
                    (block.number - lastRewardPeriodEndBlock) /
                    rewardPeriodSize +
                    1;
    }

    /**
     * @notice Initializes all reward periods that haven't been initialized yet until the current one.
     *         The first donor in a reward period will pay for that operation.
     */
    function initializeRewardPeriods() internal {
        RewardPeriod storage _lastPeriod = rewardPeriods[rewardPeriodCount];

        while (_lastPeriod.endBlock < block.number) {
            rewardPeriodCount++;
            RewardPeriod storage _newPeriod = rewardPeriods[rewardPeriodCount];
            _newPeriod.againstPeriods = againstPeriods;
            _newPeriod.startBlock = _lastPeriod.endBlock + 1;
            _newPeriod.endBlock = _newPeriod.startBlock + rewardPeriodSize - 1;
            _newPeriod.rewardPerBlock =
                (_lastPeriod.rewardPerBlock * decayNumerator) /
                decayDenominator;
            _newPeriod.stakesAmount = _lastPeriod.stakesAmount;
            _newPeriod.stakingDonationRatio = stakingDonationRatio;
            uint256 _rewardAmount = rewardPeriodSize * _newPeriod.rewardPerBlock;

            uint256 _startPeriod = (rewardPeriodCount - 1 > _lastPeriod.againstPeriods)
                ? rewardPeriodCount - 1 - _lastPeriod.againstPeriods
                : 1;

            if (!hasDonationOrStake(_startPeriod, rewardPeriodCount - 1)) {
                _rewardAmount += _lastPeriod.rewardAmount;
            }
            _newPeriod.rewardAmount = _rewardAmount;
            _lastPeriod = _newPeriod;
        }
    }

    /**
     * @notice Adds a new donation in donations list
     *
     * @param _delegateAddress address of the wallet that will claim the reward
     * @param _initialAmount amount of the donation
     * @param _target address of the receiver (community or treasury)
     */
    function _addDonation(
        address _delegateAddress,
        IERC20 _token,
        uint256 _initialAmount,
        address _target
    ) internal {
        initializeRewardPeriods();

        donationCount++;
        Donation storage _donation = donations[donationCount];
        _donation.donor = _delegateAddress;
        _donation.target = _target;
        _donation.blockNumber = block.number;
        _donation.rewardPeriod = rewardPeriodCount;
        _donation.token = _token;
        _donation.initialAmount = _initialAmount;

        if (
            _token == cUSD ||
            address(_token) == AIRDROP_V3_TOKEN_ADDRESS ||
            address(_token) == MICROCREDIT_TOKEN_ADDRESS
        ) {
            _donation.amount = _initialAmount;
        } else {
            _donation.amount = treasury.getConvertedAmount(address(_token), _initialAmount);
        }

        if (_target != address(treasury)) {
            _donation.amount = _donation.amount / communityDonationRatio;
        }

        updateRewardPeriodAmounts(rewardPeriodCount, _delegateAddress, _donation.amount);
        addCurrentRewardPeriodToDonor(_delegateAddress);

        treasury.useFundsForLP();

        emit DonationAdded(
            donationCount,
            _delegateAddress,
            _donation.amount,
            address(_token),
            _initialAmount,
            _target
        );
    }

    /**
     * @notice Adds the current reward period number to a donor's list only if it hasn't been added yet
     *
     * @param _donorAddress address of the donor
     */
    function addCurrentRewardPeriodToDonor(address _donorAddress) internal {
        Donor storage _donor = donors[_donorAddress];
        uint256 _lastDonorRewardPeriod = _donor.rewardPeriods[_donor.rewardPeriodsCount];

        //ensures that the current reward period number hasn't been added in the donor's list
        if (_lastDonorRewardPeriod != rewardPeriodCount) {
            _donor.rewardPeriodsCount++;
            _donor.rewardPeriods[_donor.rewardPeriodsCount] = rewardPeriodCount;
        }

        //if user hasn't made any donation/staking
        //set _donor.lastClaimPeriod to be previous reward period
        //to not calculate reward for epochs 1 to rewardPeriodsCount -1
        if (_donor.lastClaimPeriod == 0 && _donor.rewardPeriodsCount == 0) {
            _donor.lastClaimPeriod = rewardPeriodCount - 1;
        }
    }

    /**
     * @notice Updates the amounts of a reward period
     *
     * @param _rewardPeriodNumber number of the reward period
     * @param _donorAddress address of the donor
     * @param _amount amount to be added
     */
    function updateRewardPeriodAmounts(
        uint256 _rewardPeriodNumber,
        address _donorAddress,
        uint256 _amount
    ) internal {
        RewardPeriod storage _currentPeriod = rewardPeriods[_rewardPeriodNumber];
        _currentPeriod.donationsAmount += _amount;
        _currentPeriod.donorAmounts[_donorAddress] += _amount;
    }

    /**
     * @notice Checks if current reward period has been initialized
     *
     * @return bool true if current reward period has been initialized
     */
    function isCurrentRewardPeriodInitialized() internal view returns (bool) {
        return rewardPeriods[rewardPeriodCount].endBlock >= block.number;
    }

    function _calculateDonorIntervalAmounts(
        address _donorAddress,
        uint256 _startPeriod,
        uint256 _endPeriod
    ) internal view returns (uint256, uint256) {
        uint256 _donorAmount;
        uint256 _totalAmount;
        uint256 _index = _startPeriod;
        for (; _index <= _endPeriod; _index++) {
            RewardPeriod storage _rewardPeriod = rewardPeriods[_index];
            _donorAmount += _rewardPeriod.donorAmounts[_donorAddress];
            _totalAmount += _rewardPeriod.donationsAmount;
        }
        return (_donorAmount, _totalAmount);
    }

    function _getLastClaimablePeriod() internal returns (uint256) {
        initializeRewardPeriods();

        return rewardPeriodCount > claimDelay + 1 ? rewardPeriodCount - 1 - claimDelay : 0;
    }

    /**
     * @notice Computes the rewards
     */
    function _computeRewardsByPeriodNumber(address _donorAddress, uint256 _lastPeriodNumber)
        internal
        returns (uint256)
    {
        Donor storage _donor = donors[_donorAddress];
        uint256 _claimAmount;
        uint256 _lastDonorStakeAmount;

        (_claimAmount, _lastDonorStakeAmount) = _calculateRewardByPeriodNumber(
            _donorAddress,
            _lastPeriodNumber
        );

        if (_donor.lastClaimPeriod < _lastPeriodNumber) {
            _donor.lastClaimPeriod = _lastPeriodNumber;
        }

        rewardPeriods[_lastPeriodNumber].donorStakeAmounts[_donorAddress] = _lastDonorStakeAmount;

        if (_claimAmount == 0) {
            return _claimAmount;
        }

        if (_claimAmount > PACT.balanceOf(address(this))) {
            _claimAmount = PACT.balanceOf(address(this));
        }

        return _claimAmount;
    }

    /**
     * @notice Calculates the reward for a donor starting with his last reward period claimed
     *
     * @param _donorAddress address of the donor
     * @param _lastPeriodNumber last reward period number to be computed
     * @return _claimAmount uint256 sum of all donor's rewards that has not been claimed until _lastPeriodNumber
     * @return _lastDonorStakeAmount uint256 number of PACTs that are staked by the donor at the end of _lastPeriodNumber
     */
    function _calculateRewardByPeriodNumber(address _donorAddress, uint256 _lastPeriodNumber)
        internal
        view
        returns (uint256 _claimAmount, uint256 _lastDonorStakeAmount)
    {
        Donor storage _donor = donors[_donorAddress];

        if (_donor.lastClaimPeriod == 0 && _donor.rewardPeriodsCount == 0) {
            return (0, 0);
        }

        // _index is the last reward period number for which the donor claimed his reward
        uint256 _index = _donor.lastClaimPeriod + 1;

        // this is only used for the transition from V2 to V3
        // we have to be sure a user is not able to claim for a epoch that he's claimed
        //      so, if the _donor.lastClaimPeriod hasn't been set yet,
        //      we will start from _donor.rewardPeriods[_donor.lastClaim]
        if (_index == 1) {
            _index = _donor.rewardPeriods[_donor.lastClaim] + 1;
        }

        uint256 _donorAmount;
        uint256 _totalAmount;
        uint256 _rewardAmount;
        uint256 _stakesAmount;
        uint256 _stakingDonationRatio;

        //first time _previousRewardPeriod must be rewardPeriods[0] in order to have:
        //_currentRewardPeriod.againstPeriods = _currentRewardPeriod.againstPeriods - _previousRewardPeriod.againstPeriods
        RewardPeriod storage _previousRewardPeriod = rewardPeriods[0];
        RewardPeriod storage _currentRewardPeriod = rewardPeriods[_index];
        RewardPeriod storage _expiredRewardPeriod = rewardPeriods[0];

        //we save the stake amount of a donor at the end of each claim,
        //so rewardPeriods[_index - 1].donorStakeAmounts[_donorAddress] is the amount staked by the donor at his last claim
        _lastDonorStakeAmount = rewardPeriods[_index - 1].donorStakeAmounts[_donorAddress];

        while (_index <= _lastPeriodNumber) {
            if (_currentRewardPeriod.startBlock > 0) {
                // this case is used to calculate the reward for periods that have been initialized

                if (_currentRewardPeriod.againstPeriods == 0) {
                    _donorAmount = _currentRewardPeriod.donorAmounts[_donorAddress];
                    _totalAmount = _currentRewardPeriod.donationsAmount;
                } else if (
                    _previousRewardPeriod.againstPeriods == _currentRewardPeriod.againstPeriods
                ) {
                    if (_index > _currentRewardPeriod.againstPeriods + 1) {
                        _expiredRewardPeriod = rewardPeriods[
                            _index - 1 - _currentRewardPeriod.againstPeriods
                        ];
                        _donorAmount -= _expiredRewardPeriod.donorAmounts[_donorAddress];
                        _totalAmount -= _expiredRewardPeriod.donationsAmount;
                    }

                    _donorAmount += _currentRewardPeriod.donorAmounts[_donorAddress];
                    _totalAmount += _currentRewardPeriod.donationsAmount;
                } else {
                    if (_index > _currentRewardPeriod.againstPeriods) {
                        (_donorAmount, _totalAmount) = _calculateDonorIntervalAmounts(
                            _donorAddress,
                            _index - _currentRewardPeriod.againstPeriods,
                            _index
                        );
                    } else {
                        (_donorAmount, _totalAmount) = _calculateDonorIntervalAmounts(
                            _donorAddress,
                            0,
                            _index
                        );
                    }
                }

                _rewardAmount = _currentRewardPeriod.rewardAmount;
                _stakesAmount = _currentRewardPeriod.stakesAmount;
                _stakingDonationRatio = _currentRewardPeriod.stakingDonationRatio > 0
                    ? _currentRewardPeriod.stakingDonationRatio
                    : 1;
            } else {
                // this case is used to calculate the reward for periods that have not been initialized yet
                // E.g. calculateClaimableRewardsByPeriodNumber & calculateClaimableRewards
                // this step can be reached only after calculating the reward for periods that have been initialized

                if (_index > againstPeriods + 1) {
                    _expiredRewardPeriod = rewardPeriods[_index - 1 - againstPeriods];

                    //we already know that _donorAmount >= _expiredRewardPeriod.donorAmounts[_donorAddress]
                    //because _donorAmount is a sum of some donorAmounts, including _expiredRewardPeriod.donorAmounts[_donorAddress]
                    _donorAmount -= _expiredRewardPeriod.donorAmounts[_donorAddress];
                    //we already know that _totalAmount >= _expiredRewardPeriod.donationsAmount
                    //because _totalAmount is a sum of some donationsAmounts, including _expiredRewardPeriod.donationsAmount
                    _totalAmount -= _expiredRewardPeriod.donationsAmount;
                }

                _donorAmount += _currentRewardPeriod.donorAmounts[_donorAddress];
                _totalAmount += _currentRewardPeriod.donationsAmount;
                _rewardAmount = (_rewardAmount * decayNumerator) / decayDenominator;
            }

            if (_currentRewardPeriod.hasSetStakeAmount[_donorAddress]) {
                _lastDonorStakeAmount = _currentRewardPeriod.donorStakeAmounts[_donorAddress];
            }

            if (_donorAmount + _lastDonorStakeAmount > 0) {
                _claimAmount +=
                    (_rewardAmount *
                        (_donorAmount * _stakingDonationRatio + _lastDonorStakeAmount)) /
                    (_totalAmount * _stakingDonationRatio + _stakesAmount);
            }

            _index++;

            _previousRewardPeriod = _currentRewardPeriod;
            _currentRewardPeriod = rewardPeriods[_index];
        }

        return (_claimAmount, _lastDonorStakeAmount);
    }

    /**
     * @notice Initializes the first reward period
     *
     * @param _startingBlock first block
     * @param _firstRewardPerBlock initial reward per block
     */
    function initFirstPeriod(uint256 _startingBlock, uint256 _firstRewardPerBlock) internal {
        RewardPeriod storage _firstPeriod = rewardPeriods[1];
        _firstPeriod.startBlock = _startingBlock;
        _firstPeriod.endBlock = _startingBlock + rewardPeriodSize - 1;
        _firstPeriod.rewardPerBlock = _firstRewardPerBlock;
        _firstPeriod.rewardAmount = _firstRewardPerBlock * rewardPeriodSize;
    }

    /**
     * @notice Checks if there is any donation or stake between _startPeriod and _endPeriod
     *
     * @return bool true if there is any donation or stake
     */
    function hasDonationOrStake(uint256 _startPeriod, uint256 _endPeriod)
        internal
        view
        returns (bool)
    {
        while (_startPeriod <= _endPeriod) {
            if (
                rewardPeriods[_startPeriod].donationsAmount +
                    rewardPeriods[_startPeriod].stakesAmount >
                0
            ) {
                return true;
            }
            _startPeriod++;
        }
        return false;
    }

    /**
     * @notice Calculates the estimate reward of a donor
     *
     * @param _donorAddress             address of the donor
     * @param _inAdvanceRewardPeriods   number of reward periods in front
     *                                   if _inAdvanceRewardPeriods is 0 the method returns
     *                                        the estimated reward for current reward period
     * @return uint256 the estimate reward donor will receive after against periods based on the current donations and stakings
     */
    function _estimateDonorClaimableReward(address _donorAddress, uint256 _inAdvanceRewardPeriods)
        internal
        view
        returns (uint256)
    {
        Donor storage _donor = donors[_donorAddress];

        if (_inAdvanceRewardPeriods > currentRewardPeriodNumber() - _donor.rewardPeriods[_donor.rewardPeriodsCount]) {
            _inAdvanceRewardPeriods -= (currentRewardPeriodNumber() - _donor.rewardPeriods[_donor.rewardPeriodsCount]);
        } else {
            _inAdvanceRewardPeriods = 0;
        }
        uint256 _totalReward = _calculateRewardForTheNextXPeriods(_inAdvanceRewardPeriods);

        return _calculateDonorShare(_donorAddress, _totalReward);
    }

    /**
     * @notice Calculates the estimate reward for a new possible donation
     *
     * @param _donationAmount           amount of the new possible donation
     * @param _inAdvanceRewardPeriods   number of reward periods in front
     *                                   if _inAdvanceRewardPeriods is 0 the method returns
     *                                        the estimated reward for current reward period
     * @return uint256 the estimate reward donor will receive after against periods based on the current donations and stakings
     */
    function _estimateNewDonationClaimableReward(uint256 _donationAmount, uint256 _inAdvanceRewardPeriods)
    internal
    view
    returns (uint256)
    {
        uint256 _totalReward = _calculateRewardForTheNextXPeriods(_inAdvanceRewardPeriods);

        return _calculateNewDonationShare(_donationAmount, _totalReward);
    }

    /**
     * @notice Calculates a donor share based on the donations and stakes from the last x rewardPeriods
     *
     *
     * @return uint256  the share from the _total
     */
    function _calculateDonorShare(address _donorAddress, uint256 _total)
        internal
        view
        returns (uint256)
    {
        uint256 _donorAmount;
        uint256 _totalAmount;

        (_donorAmount, _totalAmount) = lastPeriodsDonations(_donorAddress);

        uint256 totalStakeAmount = staking.SPACT().totalSupply();
        if (totalStakeAmount == 0 && _totalAmount == 0) {
            return 0;
        }

        uint256 _stakingDonationRatio = stakingDonationRatio > 0 ? stakingDonationRatio : 1;

        return
            (_total *
                (_donorAmount * _stakingDonationRatio + staking.stakeholderAmount(_donorAddress))) /
            (_totalAmount * _stakingDonationRatio + staking.currentTotalAmount());
    }

    /**
     * @notice Calculates a new donation share based on the donations and stakes from the last x rewardPeriods
     *
     *
     * @return uint256 the estimate reward donor will receive after against periods based on the current donations and stakings
     */
    function _calculateNewDonationShare(uint256  _donationAmount, uint256 _total)
    internal
    view
    returns (uint256)
    {
        uint256 _totalAmount;

        (, _totalAmount) = lastPeriodsDonations(msg.sender);

        _totalAmount += _donationAmount;

        uint256 totalStakeAmount = staking.SPACT().totalSupply();
        if (totalStakeAmount == 0 && _totalAmount == 0) {
            return 0;
        }

        uint256 _stakingDonationRatio = stakingDonationRatio > 0 ? stakingDonationRatio : 1;

        return
            (_total *
                (_donationAmount * _stakingDonationRatio)) /
            (_totalAmount * _stakingDonationRatio + staking.currentTotalAmount());
    }

    function _calculateCurrentPeriodReward() internal view returns (uint256) {
        uint256 _currentRewardPeriodNumber = currentRewardPeriodNumber();

        uint256 _rewardPerBlock = (rewardPeriods[rewardPeriodCount].rewardPerBlock *
            decayNumerator**(_currentRewardPeriodNumber - rewardPeriodCount)) /
            decayDenominator**(_currentRewardPeriodNumber - rewardPeriodCount);

        return _rewardPerBlock * rewardPeriodSize;
    }

    function _calculateRewardForTheNextXPeriods(uint256 _inAdvanceRewardPeriods) internal view returns(uint256) {
        uint256 _currentPeriodReward = _calculateCurrentPeriodReward();
        uint256 _totalReward = _currentPeriodReward;

        while (_inAdvanceRewardPeriods > 0) {
            _currentPeriodReward = (_currentPeriodReward * decayNumerator) / decayDenominator;
            _totalReward += _currentPeriodReward;
            _inAdvanceRewardPeriods--;
        }

        return _totalReward;
    }
}
