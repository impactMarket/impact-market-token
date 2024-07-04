// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./interfaces/ICommunity.sol";
import "./interfaces/IPreviousCommunity.sol";
import "./interfaces/CommunityAdminStorageV1.sol";
import "../governor/impactMarketCouncil/interfaces/IImpactMarketCouncil.sol";
import "./interfaces/CommunityAdminStorageV3.sol";

import "hardhat/console.sol";

/**
 * @notice Welcome to CommunityAdmin, the main contract. This is an
 * administrative (for now) contract where the admins have control
 * over the list of communities. Being only able to add and
 * remove communities
 */
contract CommunityAdminImplementation is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    CommunityAdminStorageV3
{
    using SafeERC20Upgradeable for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 private constant DEFAULT_AMOUNT = 5e16;
    uint256 private constant MIN_CLAIM_AMOUNT_RATIO_PRECISION = 100;

    /**
     * @notice Triggered when a community has been added
     *
     * @param communityAddress       Address of the community that has been added
     * @param managers               Addresses of the initial managers
     * @param originalClaimAmount    Value of the originalClaimAmount
     * @param maxTotalClaim          Value of the maxTotalClaim
     * @param decreaseStep           Value of the decreaseStep
     * @param baseInterval           Value of the baseInterval
     * @param incrementInterval      Value of the incrementInterval
     * @param minTranche             Value of the minTranche
     * @param maxTranche             Value of the maxTranche
     *
     * For further information regarding each parameter, see
     * *Community* smart contract initialize method.
     */
    event CommunityAdded(
        address indexed communityAddress,
        address[] managers,
        uint256 originalClaimAmount,
        uint256 maxTotalClaim,
        uint256 decreaseStep,
        uint256 baseInterval,
        uint256 incrementInterval,
        uint256 minTranche,
        uint256 maxTranche
    );

    /**
     * @notice Triggered when a community has been removed
     *
     * @param communityAddress  Address of the community that has been removed
     */
    event CommunityRemoved(address indexed communityAddress);

    /**
     * @notice Triggered when a community has been migrated
     *
     * @param managers                 Addresses of the new community's initial managers
     * @param communityAddress         New community address
     * @param previousCommunityAddress Old community address
     */
    event CommunityMigrated(
        address[] managers,
        address indexed communityAddress,
        address indexed previousCommunityAddress
    );

    /**
     * @notice Triggered when a community has been copied
     *
     * @param originalCommunity         Address of the community that has been copied
     * @param copyCommunity             Address of the copy
     */
    event CommunityCopied(address indexed originalCommunity, address indexed copyCommunity);

    /**
     * @notice Triggered when the treasury address has been updated
     *
     * @param oldTreasury             Old treasury address
     * @param newTreasury             New treasury address
     */
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /**
     * @notice Triggered when the impactMarket Council has been updated
     *
     * @param oldImpactMarketCouncil   Old impactMarket Council address
     * @param newImpactMarketCouncil   New impactMarket Council address
     */
    event ImpactMarketCouncilUpdated(
        address indexed oldImpactMarketCouncil,
        address indexed newImpactMarketCouncil
    );

    /**
     * @notice Triggered when the ambassadors has been updated
     *
     * @param oldAmbassadors   Old Ambassador address
     * @param newAmbassadors   New Ambassador address
     */
    event AmbassadorsUpdated(address indexed oldAmbassadors, address indexed newAmbassadors);

    /**
     * @notice Triggered when the communityMiddleProxy address has been updated
     *
     * @param oldCommunityMiddleProxy   Old communityMiddleProxy address
     * @param newCommunityMiddleProxy   New communityMiddleProxy address
     */
    event CommunityMiddleProxyUpdated(
        address oldCommunityMiddleProxy,
        address newCommunityMiddleProxy
    );

    /**
     * @notice Triggered when the communityImplementation address has been updated
     *
     * @param oldCommunityImplementation    Old communityImplementation address
     * @param newCommunityImplementation    New communityImplementation address
     */
    event CommunityImplementationUpdated(
        address indexed oldCommunityImplementation,
        address indexed newCommunityImplementation
    );

    /**
     * @notice Triggered when a community has been funded
     *
     * @param community           Address of the community
     * @param amount              Amount of the funding
     */
    event CommunityFunded(address indexed community, uint256 amount);

    /**
     * @notice Triggered when an amount of an ERC20 has been transferred from this contract to an address
     *
     * @param token               ERC20 token address
     * @param to                  Address of the receiver
     * @param amount              Amount of the transaction
     */
    event TransferERC20(address indexed token, address indexed to, uint256 amount);

    /**
     * @notice Enforces sender to be a valid community
     */
    modifier onlyCommunities() {
        require(communities[msg.sender] == CommunityState.Valid, "CommunityAdmin: NOT_COMMUNITY");
        _;
    }

    /**
     * @notice Enforces sender to DAO or impactMarketCouncil
     */
    modifier onlyOwnerOrImpactMarketCouncil() {
        require(
            msg.sender == owner() || msg.sender == address(impactMarketCouncil),
            "CommunityAdmin: Not Owner Or ImpactMarketCouncil"
        );
        _;
    }

    /**
     * @notice Used to initialize a new CommunityAdmin contract
     *
     * @param _communityImplementation    Address of the Community implementation
     *                              used for deploying new communities
     * @param _cUSD                 Address of the cUSD token
     */
    function initialize(ICommunity _communityImplementation, IERC20 _cUSD) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        communityImplementation = _communityImplementation;
        cUSD = _cUSD;

        communityProxyAdmin = new ProxyAdmin();
    }

    /**
     * @notice Returns the current implementation version
     */
    function getVersion() external pure override returns (uint256) {
        return 3;
    }

    /**
     * @notice Returns the address of a community from communityList
     *
     * @param _index index of the community
     * @return address of the community
     */
    function communityListAt(uint256 _index) external view override returns (address) {
        return communityList.at(_index);
    }

    /**
     * @notice Returns the number of communities
     *
     * @return uint256 number of communities
     */
    function communityListLength() external view override returns (uint256) {
        return communityList.length();
    }

    /**
     * @notice Returns the MIN_CLAIM_AMOUNT_RATIO_PRECISION
     *
     * @return uint256 number of communities
     */
    function minClaimAmountRatioPrecision() external pure override returns (uint256) {
        return MIN_CLAIM_AMOUNT_RATIO_PRECISION;
    }

    /**
     * @notice Returns if an address is the ambassador or entity of the community
     *
     * @return bool true if the address is an ambassador or entity of the community
     */
    function isAmbassadorOrEntityOfCommunity(address _community, address _ambassadorOrEntity)
        external
        view
        override
        returns (bool)
    {
        return
            ambassadors.isAmbassadorOf(_ambassadorOrEntity, _community) ||
            ambassadors.isEntityOf(_ambassadorOrEntity, _community);
    }

    /**
     * @notice Updates the address of the treasury
     *
     * @param _newTreasury address of the new treasury contract
     */
    function updateTreasury(ITreasury _newTreasury) external override onlyOwner {
        emit TreasuryUpdated(address(treasury), address(_newTreasury));
        treasury = _newTreasury;
    }

    /**
     * @notice Updates the address of the the communityImplementation
     *
     * @param _newCommunityImplementation address of the new communityImplementation contract
     */
    function updateCommunityImplementation(ICommunity _newCommunityImplementation)
        external
        override
        onlyOwner
    {
        emit CommunityImplementationUpdated(
            address(communityImplementation),
            address(_newCommunityImplementation)
        );
        communityImplementation = _newCommunityImplementation;
    }

    /** Updates the address of the backend wallet
     *
     * @param _newAuthorizedWalletAddress address of the new backend wallet
     */
    function updateAuthorizedWalletAddress(address _newAuthorizedWalletAddress)
        external
        override
        onlyOwnerOrImpactMarketCouncil
    {
        authorizedWalletAddress = _newAuthorizedWalletAddress;
    }

    /** Updates the value of the minClaimAmountRatio
     *
     * @param _newMinClaimAmountRatio value of the minClaimAmountRatio
     *
     * !!! be aware that this value will be divided by MIN_CLAIM_AMOUNT_RATIO_PRECISION
     */
    function updateMinClaimAmountRatio(uint256 _newMinClaimAmountRatio)
        external
        override
        onlyOwnerOrImpactMarketCouncil
    {
        require(
            _newMinClaimAmountRatio >= MIN_CLAIM_AMOUNT_RATIO_PRECISION,
            "CommunityAdmin::updateMinClaimAmountRatio: Invalid minClaimAmountRatio"
        );
        minClaimAmountRatio = _newMinClaimAmountRatio;
    }

    /** Updates the value of the treasurySafetyPercentage
     *
     * @param _newTreasurySafetyPercentage value of the treasurySafetyPercentage
     *
     */
    function updateTreasurySafetyPercentage(uint256 _newTreasurySafetyPercentage)
        external
        override
        onlyOwnerOrImpactMarketCouncil
    {
        require(
            _newTreasurySafetyPercentage > 0 && _newTreasurySafetyPercentage < 101,
            "CommunityAdmin::updateTreasurySafetyPercentage: Invalid treasurySafetyPercentage"
        );
        treasurySafetyPercentage = _newTreasurySafetyPercentage;
    }

    /** Updates the value of the treasuryMinBalance
     *
     * @param _newTreasuryMinBalance value of the treasuryMinBalance
     *
     */
    function updateTreasuryMinBalance(uint256 _newTreasuryMinBalance)
        external
        override
        onlyOwnerOrImpactMarketCouncil
    {
        treasuryMinBalance = _newTreasuryMinBalance;
    }

    /**
     * @notice Set an existing ambassador to an existing community
     *
     * @param _ambassador address of the ambassador
     * @param _community address of the community contract
     */
    function setCommunityToAmbassador(address _ambassador, ICommunity _community)
        external
        override
        onlyOwnerOrImpactMarketCouncil
    {
        ambassadors.setCommunityToAmbassador(_ambassador, address(_community));
    }

    /**
     * @notice Adds a new community
     *
     * @param _tokenAddress         address of the token used by the community
     * @param _managers             addresses of the community managers
     * @param _ambassador           address of the ambassador
     * @param _originalClaimAmount  maximum base amount to be claim by the beneficiary
     * @param _maxTotalClaim        limit that a beneficiary can claim at in total
     * @param _decreaseStep         value decreased from maxTotalClaim for every beneficiary added
     * @param _baseInterval         base interval to start claiming
     * @param _incrementInterval    increment interval used in each claim
     * @param _minTranche           minimum amount that the community will receive when requesting funds
     * @param _maxTranche           maximum amount that the community will receive when requesting funds
     * @param _maxBeneficiaries     maximum number of valid beneficiaries
     */
    function addCommunity(
        address _tokenAddress,
        address[] memory _managers,
        address _ambassador,
        uint256 _originalClaimAmount,
        uint256 _maxTotalClaim,
        uint256 _decreaseStep,
        uint256 _baseInterval,
        uint256 _incrementInterval,
        uint256 _minTranche,
        uint256 _maxTranche,
        uint256 _maxBeneficiaries
    ) external override onlyOwnerOrImpactMarketCouncil {
        require(
            _managers.length > 0,
            "CommunityAdmin::addCommunity: Community should have at least one manager"
        );

        address _communityAddress = _deployCommunity(
            _tokenAddress,
            _managers,
            _originalClaimAmount,
            _maxTotalClaim,
            _decreaseStep,
            _baseInterval,
            _incrementInterval,
            _minTranche,
            _maxTranche,
            _maxBeneficiaries,
            ICommunity(address(0))
        );
        require(_communityAddress != address(0), "CommunityAdmin::addCommunity: NOT_VALID");
        communities[_communityAddress] = CommunityState.Valid;
        communityList.add(_communityAddress);
        ambassadors.setCommunityToAmbassador(_ambassador, address(_communityAddress));

        emit CommunityAdded(
            _communityAddress,
            _managers,
            _originalClaimAmount,
            _maxTotalClaim,
            _decreaseStep,
            _baseInterval,
            _incrementInterval,
            _minTranche,
            _maxTranche
        );

        transferToCommunity(ICommunity(_communityAddress), _minTranche);

        if (cUSD.balanceOf(address(treasury)) >= DEFAULT_AMOUNT) {
            treasury.transfer(cUSD, address(_managers[0]), DEFAULT_AMOUNT);
        }
    }

    /**
     * @notice Migrates a community by deploying a new contract.
     *
     * @param _managers address of the community managers
     * @param _previousCommunity address of the community to be migrated
     */
    function migrateCommunity(address[] memory _managers, ICommunity _previousCommunity)
        external
        override
        onlyOwnerOrImpactMarketCouncil
        nonReentrant
    {
        require(
            communities[address(_previousCommunity)] != CommunityState.Migrated,
            "CommunityAdmin::migrateCommunity: this community has been migrated"
        );

        communities[address(_previousCommunity)] = CommunityState.Migrated;

        IERC20 _previousCommunityToken = (_previousCommunity.getVersion() == 1)
            ? _previousCommunity.cUSD()
            : _previousCommunity.token();

        uint256 _previousOriginalClaimAmount = (_previousCommunity.getVersion() >= 3)
            ? _previousCommunity.originalClaimAmount()
            : IPreviousCommunity(address(_previousCommunity)).claimAmount();

        address newCommunityAddress = _deployCommunity(
            address(_previousCommunityToken),
            _managers,
            _previousOriginalClaimAmount,
            _previousCommunity.getInitialMaxClaim(),
            _previousCommunity.decreaseStep(),
            _previousCommunity.baseInterval(),
            _previousCommunity.incrementInterval(),
            _previousCommunity.minTranche(),
            _previousCommunity.maxTranche(),
            _previousCommunity.getVersion() > 1 ? _previousCommunity.maxBeneficiaries() : 0,
            _previousCommunity
        );

        require(newCommunityAddress != address(0), "CommunityAdmin::migrateCommunity: NOT_VALID");

        uint256 balance = _previousCommunityToken.balanceOf(address(_previousCommunity));
        _previousCommunity.transfer(_previousCommunityToken, newCommunityAddress, balance);

        communities[newCommunityAddress] = CommunityState.Valid;
        communityList.add(newCommunityAddress);

        emit CommunityMigrated(_managers, newCommunityAddress, address(_previousCommunity));
    }

    /**
     * @notice Migrates a community by deploying a new contract.
     *
     * @param _community       address of the community to be split
     * @param _numberOfCopies  the number of communities that will copy the data
     * @param _ambassador address of the ambassador
     * @param _managers address of the community managers
     */
    function splitCommunity(
        ICommunity _community,
        uint256 _numberOfCopies,
        address _ambassador,
        address[] memory _managers
    ) external override onlyOwnerOrImpactMarketCouncil nonReentrant {
        require(
            communities[address(_community)] == CommunityState.Valid,
            "CommunityAdmin::splitCommunity: invalid community state"
        );

        require(
            _community.getVersion() >= 3,
            "CommunityAdmin::splitCommunity: invalid community version"
        );

        address _newCommunityAddress;
        while (_numberOfCopies > 0) {
            --_numberOfCopies;

            _newCommunityAddress = _deployCommunity(
                address(_community.token()),
                _managers,
                _community.originalClaimAmount(),
                _community.getInitialMaxClaim(),
                _community.decreaseStep(),
                _community.baseInterval(),
                _community.incrementInterval(),
                _community.minTranche(),
                _community.maxTranche(),
                _community.maxBeneficiaries(),
                ICommunity(address(0))
            );

            require(
                _newCommunityAddress != address(0),
                "CommunityAdmin::migrateCommunity: NOT_VALID"
            );

            communities[_newCommunityAddress] = CommunityState.Valid;
            communityList.add(_newCommunityAddress);

            _community.addCopy(ICommunity(_newCommunityAddress));
            ICommunity(_newCommunityAddress).copyCommunityDetails(_community);

            ambassadors.setCommunityToAmbassador(_ambassador, _newCommunityAddress);

            emit CommunityCopied(address(_community), _newCommunityAddress);
        }
    }

    /**
     * @notice Removes an existing community. All community funds are transferred to the treasury
     *
     * @param _community address of the community
     */
    function removeCommunity(ICommunity _community)
        external
        override
        onlyOwnerOrImpactMarketCouncil
        nonReentrant
    {
        require(
            communities[address(_community)] == CommunityState.Valid,
            "CommunityAdmin::removeCommunity: this isn't a valid community"
        );
        communities[address(_community)] = CommunityState.Removed;

        ambassadors.removeCommunity(address(_community));

        IERC20 _token = (_community.getVersion() == 1) ? _community.cUSD() : _community.token();

        _community.transfer(_token, address(treasury), _token.balanceOf(address(_community)));
        emit CommunityRemoved(address(_community));
    }

    /**
     * @dev Funds an existing community if it hasn't enough funds
     */
    function fundCommunity() external override onlyCommunities returns (uint256) {
        ICommunity _community = ICommunity(msg.sender);
        IERC20 _token = (_community.getVersion() == 1) ? _community.cUSD() : _community.token();
        uint256 _balance = _token.balanceOf(msg.sender);

        uint256 _amount = calculateCommunityTrancheAmount(ICommunity(msg.sender));

        if (_amount > 0) {
            transferToCommunity(_community, _amount);
        }

        return _amount;
    }

    /**
     * @dev Transfers community tokens from the treasury to a community
     *
     * @param _beneficiary   address of the beneficiary
     * @param _amount        amount to be transferred from treasury to community
     */
    function transferToBeneficiary(
        IERC20 _token,
        address _beneficiary,
        uint256 _amount
    ) external override onlyCommunities nonReentrant {
        treasury.transfer(_token, _beneficiary, _amount);
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

    /**
     * @notice Transfers an amount of an ERC20 from community to an address
     *
     * @param _community address of the community
     * @param _token address of the ERC20 token
     * @param _to address of the receiver
     * @param _amount amount of the transaction
     */
    function transferFromCommunity(
        ICommunity _community,
        IERC20 _token,
        address _to,
        uint256 _amount
    ) external override onlyOwner nonReentrant {
        _community.transfer(_token, _to, _amount);
    }

    /** @notice Updates the beneficiary params of a community
     *
     * @param _community address of the community
     * @param _originalClaimAmount  maximum base amount to be claim by the beneficiary
     * @param _maxTotalClaim limit that a beneficiary can claim  in total
     * @param _decreaseStep value decreased from maxTotalClaim each time a is beneficiary added
     * @param _baseInterval base interval to start claiming
     * @param _incrementInterval increment interval used in each claim
     * @param _maxBeneficiaries maximum number of beneficiaries
     */
    function updateBeneficiaryParams(
        ICommunity _community,
        uint256 _originalClaimAmount,
        uint256 _maxTotalClaim,
        uint256 _decreaseStep,
        uint256 _baseInterval,
        uint256 _incrementInterval,
        uint256 _maxBeneficiaries
    ) external override onlyOwnerOrImpactMarketCouncil {
        _community.updateBeneficiaryParams(
            _originalClaimAmount,
            _maxTotalClaim,
            _decreaseStep,
            _baseInterval,
            _incrementInterval
        );

        _community.updateMaxBeneficiaries(_maxBeneficiaries);
    }

    /** @notice Updates params of a community
     *
     * @param _community address of the community
     * @param _minTranche minimum amount that the community will receive when requesting funds
     * @param _maxTranche maximum amount that the community will receive when requesting funds
     */
    function updateCommunityParams(
        ICommunity _community,
        uint256 _minTranche,
        uint256 _maxTranche
    ) external override onlyOwnerOrImpactMarketCouncil {
        _community.updateCommunityParams(_minTranche, _maxTranche);
    }

    /** @notice Updates token address of a community
     *
     * @param _community      address of the community
     * @param _newToken       new token address
     * @param _exchangePath   path used by uniswap to exchange the current tokens to the new tokens
     */
    function updateCommunityToken(
        ICommunity _community,
        IERC20 _newToken,
        bytes memory _exchangePath,
        uint256 _originalClaimAmount,
        uint256 _maxTotalClaim,
        uint256 _decreaseStep,
        uint256 _baseInterval,
        uint256 _incrementInterval
    ) external override onlyOwnerOrImpactMarketCouncil {
        _community.updateToken(
            _newToken,
            _exchangePath,
            _originalClaimAmount,
            _maxTotalClaim,
            _decreaseStep,
            _baseInterval,
            _incrementInterval
        );
    }

    /**
     * @notice Updates proxy implementation address of a community
     * use this only for changing the implementation for one community
     * for updating the implementation for (almost) all communities, just update the communityImplementation param
     *
     * @param _communityMiddleProxy address of the community
     * @param _newCommunityImplementation address of new implementation contract
     */
    function updateProxyImplementation(
        address _communityMiddleProxy,
        address _newCommunityImplementation
    ) external override onlyOwnerOrImpactMarketCouncil {
        communityProxyAdmin.upgrade(
            TransparentUpgradeableProxy(payable(_communityMiddleProxy)),
            _newCommunityImplementation
        );
    }

    /**
     * @notice Updates proxy implementation address of impactMarket council
     *
     * @param _newImpactMarketCouncil address of new implementation contract
     */
    function updateImpactMarketCouncil(IImpactMarketCouncil _newImpactMarketCouncil)
        external
        override
        onlyOwner
    {
        emit ImpactMarketCouncilUpdated(
            address(impactMarketCouncil),
            address(_newImpactMarketCouncil)
        );
        impactMarketCouncil = _newImpactMarketCouncil;
    }

    /**
     * @notice Updates proxy implementation address of ambassadors
     *
     * @param _newAmbassadors address of new implementation contract
     */
    function updateAmbassadors(IAmbassadors _newAmbassadors) external override onlyOwner {
        emit AmbassadorsUpdated(address(ambassadors), address(_newAmbassadors));
        ambassadors = _newAmbassadors;
    }

    /**
     * @notice Updates communityMiddleProxy address
     *
     * @param _newCommunityMiddleProxy address of new implementation contract
     */
    function updateCommunityMiddleProxy(address _newCommunityMiddleProxy)
        external
        override
        onlyOwner
    {
        emit CommunityMiddleProxyUpdated(communityMiddleProxy, _newCommunityMiddleProxy);
        communityMiddleProxy = _newCommunityMiddleProxy;
    }

    /**
     * @notice Gets a community implementation address
     *
     * @param _communityProxyAddress  address of the community
     */
    function getCommunityProxyImplementation(address _communityProxyAddress)
        external
        view
        override
        returns (address)
    {
        return
            communityProxyAdmin.getProxyImplementation(
                TransparentUpgradeableProxy(payable(_communityProxyAddress))
            );
    }

    /**
     * @dev Transfers community tokens from the treasury to a community
     *
     * @param _community address of the community
     * @param _amount amount of the transaction
     */
    function transferToCommunity(ICommunity _community, uint256 _amount) internal nonReentrant {
        IERC20 _token = (_community.getVersion() == 1) ? _community.cUSD() : _community.token();

        if (_token.balanceOf(address(treasury)) >= _amount) {
            treasury.transfer(_token, address(_community), _amount);

            emit CommunityFunded(address(_community), _amount);
        }
    }

    /**
     * @dev Internal implementation of deploying a new community
     *
     * @param _tokenAddress        Address of the token used by the community
     * @param _managers addresses of the community managers
     * @param _originalClaimAmount base amount to be claim by the beneficiary
     * @param _maxTotalClaim limit that a beneficiary can claim at in total
     * @param _decreaseStep value decreased from maxTotalClaim for every beneficiary added
     * @param _baseInterval base interval to start claiming
     * @param _incrementInterval increment interval used in each claim
     * @param _minTranche minimum amount that the community will receive when requesting funds
     * @param _maxTranche maximum amount that the community will receive when requesting funds
     * @param _maxBeneficiaries maximum number of valid beneficiaries
     * @param _previousCommunity address of the previous community. Used for migrating communities
     */
    function _deployCommunity(
        address _tokenAddress,
        address[] memory _managers,
        uint256 _originalClaimAmount,
        uint256 _maxTotalClaim,
        uint256 _decreaseStep,
        uint256 _baseInterval,
        uint256 _incrementInterval,
        uint256 _minTranche,
        uint256 _maxTranche,
        uint256 _maxBeneficiaries,
        ICommunity _previousCommunity
    ) internal returns (address) {
        TransparentUpgradeableProxy _community = new TransparentUpgradeableProxy(
            address(communityMiddleProxy),
            address(communityProxyAdmin),
            ""
        );

        ICommunity(address(_community)).initialize(
            _tokenAddress,
            _managers,
            _originalClaimAmount,
            _maxTotalClaim,
            _decreaseStep,
            _baseInterval,
            _incrementInterval,
            _minTranche,
            _maxTranche,
            _maxBeneficiaries,
            _previousCommunity
        );

        return address(_community);
    }

    /** @dev Calculates the tranche amount of a community.
     *
     * @param _community      address of the community
     * @return uint256        the value of the tranche amount
     */
    function calculateCommunityTrancheAmount(ICommunity _community)
        public
        view
        override
        returns (uint256)
    {
        IERC20 _token = (_community.getVersion() == 1) ? _community.cUSD() : _community.token();
        uint256 _communityBalance = _token.balanceOf(address(_community));
        uint256 _minTranche = _community.minTranche();
        uint256 _maxTranche = _community.maxTranche();

        if (
            _communityBalance >= _minTranche ||
            block.number <= _community.lastFundRequest() + _community.baseInterval() ||
            _token.balanceOf(address(treasury)) < treasuryMinBalance ||
            _maxTranche == 0
        ) {
            return 0;
        }

        uint256 _validBeneficiaries = _community.validBeneficiaryCount();
        uint256 _originalClaimAmount = (_community.getVersion() >= 3)
            ? _community.originalClaimAmount()
            : IPreviousCommunity(address(_community)).claimAmount();

        uint256 _trancheAmount = _validBeneficiaries * _originalClaimAmount;

        // no need to have a minTranche, considering that every claim triggers the request fund
        //        if (_trancheAmount < _minTranche) {
        //            _trancheAmount = _minTranche;
        //        }

        if (_trancheAmount > _maxTranche) {
            _trancheAmount = _maxTranche;
        }

        uint256 _amount;
        if (_trancheAmount > _communityBalance) {
            _amount = _trancheAmount - _communityBalance;

            uint256 _treasurySafetyBalance = (_token.balanceOf(address(treasury)) *
                treasurySafetyPercentage) / 100;

            if (_amount > _treasurySafetyBalance) {
                _amount = _treasurySafetyBalance;
            }
        }

        return _amount;
    }
}
